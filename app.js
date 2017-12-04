/*eslint-disable no-else-return */
const express = require('express');
const app = express();
const Api = require('kubernetes-client');
if(process.env.NODE_ENV == 'develop'){
    process.env.NODE_CONFIG_DIR = './dockerImageBuilder/config'
}else{
process.env.NODE_CONFIG_DIR = './config'
}
//process.env.NODE_CONFIG_DIR = './dockerImageBuilder/config'
var jobs = require('./bgjobs.js');
var request = require('request');
var bodyParser = require("body-parser");
var util = require('util');
var config = require('config').get('dbConfig');
var queueUrl = "http://127.0.0.1:3001";
var dockerUrl = "http://"+config.get("remoteDocker.host")+":"+config.get("remoteDocker.port");
var dockerRegistryUrl = "http://"+config.get("dockerRegistry.host")+":"+config.get("dockerRegistry.port");
var async = require('async');
app.use(bodyParser.json());

/*
 * Kubernete token Validates API(HTTP Filter)
 * ToDo: Token 이 유저마다 발급되면 namespace 부분 변경해야함
 */
app.use(function(req, res, next) {
    
  if (!req.headers.authorization) {
      
    return res.status(403).json({ status: "error", msg: 'No credentials sent!' });
    
  }else{
      
    var token = req.headers.authorization;
    token = token.split("Bearer ")[1];
            const ext = new Api.Extensions({
              url: 'https://'+config.get("kubernetes.host")+":"+config.get("kubernetes.port"),
              insecureSkipTlsVerify: true,
              auth: {
                 bearer: token
              },
              version: 'v1beta1',
              namespace: "kube-system"
        });
        
    if(ext == undefined){
        
         return res.status(401).json({ status: "error", msg: 'Unauthorization' });
         
    }else{
        
        ext.namespaces.deployments('kube-dns').get((err,result) => validateToken(err, result, res, next));
        
    }
  }
});

/*
 * HealthCheck API(HTTP GET)
 * 
 */
app.get('/',(req,res) => {
    
     res.setHeader("Content-Type", "application/json");
     res.send({'health':'ok'});
});


/*
 * 이미지 빌드 API(HTTP POST)
 * 
 */
app.post('/builder/build', (req, res, next) => {
    console.log(req.body);
    var project = req.body.project;
    var builderImage = req.body.builderImage;
    var projectName = req.body.projectName;
    console.log("Request Data::"+project+", "+dockerUrl+", "+builderImage+", "+projectName);
    var data = {
                project: project,
                builderImage: builderImage,
                projectName: projectName,
                dockerUrl: dockerUrl
                };
    jobs.createQueue('build',data);
    next();
  
 });
 
 /*
 * 이미지 빌드 API 호출 후 내부적으로 호출되는 미들웨어
 * 
 */
app.post('/builder/build',(req,res) => {
    var project = req.body.project;
    var projectName = req.body.projectName;
    
        request(queueUrl+'/job/search?q='+projectName, function(error, response, body){ //현재 이미지 빌드 중인 Job 의 ID를 가져온다
        
            console.log('error:', error); 
            console.log('statusCode:', response && response.statusCode); 
            console.log('body:', response.body);
            res.setHeader("Content-Type", "application/json");
            res.send({'status':'ok','msg':'Project '+project+' Build Job Id is..'+body});      
        
        });  
});

/*
 * 이미지 푸쉬 API(HTTP POST)
 * 
 */
app.post('/builder/image/:projectName',(req,res, next) => {
        var projectName = req.params.projectName;
        var data = {
            projectName : projectName
        };
        jobs.createQueue('push',data);        
        next();
});

/*
 * 이미지 푸쉬 API 호출 후 내부적으로 호출되는 미들웨어
 * 
 */
app.post('/builder/image/:projectName',(req,res) => {
         var projectName = req.params.projectName;
    
        request(queueUrl+'/job/search?q='+projectName, function(error, response, body){ //현재 이미지 푸쉬 중인 Job 의 ID를 가져온다다
        
            console.log('error:', error); 
            console.log('statusCode:', response && response.statusCode); 
            console.log('body:', response.body);
            var returnVal = {
                task: 'buildImage',
                status: 'ok',
                values: JSON.parse(response.body)
            };
            //res.send({'status':'ok','values':'Project '+projectName+' Push Job Id is..'+body});      
            res.setHeader("Content-Type", "application/json");
            res.send(returnVal);
        
        });  
});

/*
 * 빌드된 이미지 목록을 가져오는 API(HTTP GET)
 * ToDo : 빌드된 이미지가 푸쉬가 됬는지 안됬는지 분류 필요
 */
app.get('/builder/build',(req, res) => {
     
     request(dockerUrl+'/v1.24/images/json?filters=%7B%22label%22%3A%7B%22io.openshift.s2i.build.image%22%3Atrue%7D%7D', function(error, response, body){ //빌더VM의 로컬 이미지 목록중 실제 빌드한 이미지목록
        
            console.log('error:', error); 
            console.log('statusCode:', response && response.statusCode); 
            console.log('body:', response.body);
            var returnVal = {
                task: 'BuildImageList',
                status: 'ok',
                values: JSON.parse(response.body)
            };
            //res.send({'status':'ok','values':'Project '+projectName+' Push Job Id is..'+body});      
            res.setHeader("Content-Type", "application/json");
            res.send(returnVal);
        
        });     
});

/*
 * 이미지 빌드에 관련된 로그를 가져오는API(HTTP GET)
 * 해당 로그는 이미지 빌드 완료시 삭제된다.
 * Decision : 이미지빌더에서 로그를 영구보관해야하는지 결
 * 
 */
app.get('/builder/build/:id/log',(req, res) => {
    request(queueUrl+'/job/'+req.params.id+'/log', function(error, response, body){
        
            console.log('error:', error); 
            console.log('statusCode:', response && response.statusCode); 
            console.log('body:', response.body);
            res.setHeader("Content-Type", "application/json");
            var returnVal = {
                task: 'buildLog_'+req.params.id,
                status: 'ok',
                values: JSON.parse(response.body)
            };
            //res.send({'status':'log','msg':response.body});      
            res.setHeader("Content-Type", "application/json");
            res.send(returnVal);
        
    });  
});

/*
 * 이미지 빌드 및 푸쉬에 대한 진행 현황을 체크하는 API(HTTP GET)
 * 크게 RUNNING / FINISHED 2가지 상태로 나뉨
 * 
 */
app.get('/builder/progress/:id',(req, res) => {
   
   jobs.progressQueue(req.params.id, res);    
   
});

/*
 * Registry 에 푸쉬된 이미지들의 목록 조회 API(HTTP GET)
 * 
 */
app.get('/builder/image',(req, res) => {
    
   request(dockerRegistryUrl+'/v2/_catalog', function(error, response, body){
        
            console.log('error:', error); 
            console.log('statusCode:', response && response.statusCode); 
            console.log('body:', response.body);
            res.setHeader("Content-Type", "application/json");
            var imageArray = JSON.parse(response.body);
            var tagArray = new Array();
            imageArray = imageArray.repositories;            
            /*
             * Response Json Structure
             * 
             * {status: "pushList", images:
             *     [
             *        {image_name: 'imge', tags: []},
             *         ...
             *      ]
             *  }
             * 
             */
             async.each(imageArray, function(data, callback){
                
                tag_req = request(dockerRegistryUrl+'/v2/'+data+'/tags/list', function(error, response, body){
                    tagArray.push(JSON.parse(response.body));
                     if(tagArray.length == imageArray.length){ //마지막까지 다 담았으면 Response 를 보내야 함
                          res.send({'task':'registryList','status':'ok','values': tagArray});   
                     }
                });
            });
    });  
   
});

app.listen(3000, () => {
  console.log('listening on port 3000!');
});

function validateToken(err, result, res, next) {
  if(err != undefined){
       return res.status(401).json({ status: "error", msg: 'Unauthorized' });
  }else{
      console.log("no ERROR!!");
      next();
  }
}
