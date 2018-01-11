/*eslint-disable no-else-return */
/*
 * Loggin Module
 */
const winston = require('winston');
const Logger = winston.Logger;
const Console = winston.transports.Console;
const LoggingWinston = require('@google-cloud/logging-winston');
const loggingWinston = new LoggingWinston();
const logger = new Logger({ 
  level: 'info',
  transports: [
    new Console(),
    loggingWinston,
  ],
});
/*
 * Express Module
 */

const express = require('express');
const app = express();
const Api = require('kubernetes-client');
if(process.env.NODE_ENV == 'develop'){
    process.env.NODE_CONFIG_DIR = './dockerImageBuilder/config'
}else{
process.env.NODE_CONFIG_DIR = './config'
}
process.setMaxListeners(15);
var jobs = require('./bgjobs.js');
var request = require('request');
var bodyParser = require("body-parser");
var compression = require("compression");
var util = require('util');
var config = require('config').get('dbConfig');
//var adminToken = require('config').get('token');
var queueUrl = "http://127.0.0.1:3001";
var dockerUrl = "http://"+config.get("remoteDocker.host")+":"+config.get("remoteDocker.port");
var dockerRegistryUrl = "http://"+config.get("dockerRegistry.host")+":"+config.get("dockerRegistry.port");
var kubernetesUrl = 'https://'+config.get("kubernetes.host")+":"+config.get("kubernetes.port");
var async = require('async');
var net = require('net');
app.use(bodyParser.json());
app.use(compression());

/*
 * Kubernete token Validates API(HTTP Filter)
 * 사용자 Token를 1차 체크 후 namespace 내에 serviceaccount 존재 여부로 2차 체크 함
 */

app.use(function(req, res, next) {
      
      if ( req.path == '/' || req.parth == '/v1') return next();      
       
      if (!req.headers.authorization) {
          
        return res.status(403).json({ status: "error", msg: 'No credentials sent!' });
        
      }else{
          
        var token = req.headers.authorization;
        var namespace = req.headers.namespace;
            token = token.split("Bearer ")[1];
            
        if(token == undefined){
             return res.status(400).json({ status: "error", msg: 'Empty Token Value' });
        }   
        
        let buff = new Buffer(token, 'base64');  
        let decodetoken = buff.toString('ascii');
        
                const ext = new Api.Core({
                  url: kubernetesUrl,
                  insecureSkipTlsVerify: true,
                  auth: {
                     bearer: decodetoken
                  },
                  version: 'v1',
                  namespace: namespace
            });
            
        if(ext == undefined){
            
             return res.status(401).json({ status: "error", msg: 'Unauthorization' });
             
        }else{
            ext.namespaces.serviceaccounts('default').get((err,result) => validateToken(err, result, res, next));
            
        }
      }
  
});

/*
 * HealthCheck API(HTTP GET)
 * API Server 기동 여부만 확인
 */
app.get(['/','/v1'],(req,res) => {
    
     res.setHeader("Content-Type", "application/json");
     res.send({'health':'ok'});
});

/*
 * ConnectionCheck API(HTTP GET)
 * Docker Registry -> Docker -> Redis 순으로 연결 체크를 함
 * 
 */
app.get('/v1/conn',(req,res) => {
    
     request(dockerRegistryUrl+'/v2/', function(registryerror, registryresponse, registrybody){
        
            if(registryerror != undefined){
              logger.error('[Docker Image Builder] ERROR - Registry Connection:', registryerror); 
              logger.error('[Docker Image Builder] ERROR - Registry Connection_statusCode:', registryresponse && registryresponse.statusCode);
            }
            res.setHeader("Content-Type", "application/json");
            
            if(registryresponse.statusCode != "200"){
                res.statusCode = registryresponse.statusCode;
                res.send({'category':'registryConnection','status':'err', 'msg': registryerror});  
            }else{
              request(dockerUrl+'/v1.24/containers/json?all=1', function(dockererror, dockerresponse, dockerbody){
                  
                  if(dockererror != undefined){
                  
                    logger.error('[Docker Image Builder] ERROR - Docker Connection:', dockererror); 
                    logger.error('[Docker Image Builder] ERROR - Docker Connection_statusCode:', dockerresponse && dockerresponse.statusCode);
                  
                  }
                  
                  if(dockerresponse.statusCode != "200"){
                      res.statusCode = dockerresponse.statusCode;
                      res.send({'category':'dockerConnection', 'msg': dockererror});  

                  }else{
                      
                      var client = net.connect(config.get('redis.port'), config.get('redis.host'), function() {                            
                          client.destroy();
                          res.send({'category':'allConnection','status':'ok', 'msg':'All Connection Green'});  
                        });
                        client.on('error', function(ex) {
                          client.destroy();
                          res.statusCode = 404;
                          res.send({'category':'queueStoreConnection','status':'err', 'msg':'Redis Not Found'}); 
                        });
                      
                  }

              });

            }            

    });
});


/*
 * 이미지 빌드 API(HTTP POST)
 * 
 */
app.post('/v1/builder/build', (req, res, next) => {
    
    var project = req.body.project;
    var builderImage = req.body.builderImage;
    var projectName = req.body.projectName;
    logger.info("[Docker Image Builder] INFO - /v1/builder/build Request Data:"+project+", "+config.get("remoteDocker.host")+":"+config.get("remoteDocker.port")+", "+builderImage+", "+projectName);
    var data = {
                project: project,
                builderImage: builderImage,
                projectName: projectName,
                dockerUrl: config.get("remoteDocker.host")+":"+config.get("remoteDocker.port")
                };
    jobs.createQueue('build',data);
    next();
  
 });
 
 /*
 * 이미지 빌드 API 호출 후 내부적으로 호출되는 미들웨어
 * 
 */
app.post('/v1/builder/build',(req,res) => {
    var project = req.body.project;
    var projectName = req.body.projectName;
        logger.info(queueUrl);
        request(queueUrl+'/job/search?q='+projectName, function(error, response, body){ //현재 이미지 빌드 중인 Job 의 ID를 가져온다
            if(error != undefined){
              logger.error('[Docker Image Builder] ERROR - Queue Search:', error); 
              logger.error('[Docker Image Builder] ERROR - Queue Search_statusCode:', response && response.statusCode); 
              logger.error('[Docker Image Builder] ERROR - Queue Search_body:', response.body);
            }
            res.setHeader("Content-Type", "application/json");
            var result = JSON.parse(body);
            
            res.send({'task':'BuildImage', 'status':'ok','value':result[result.length-1]});      
        
        });  
});

/*
 * 이미지 푸쉬 API(HTTP POST)
 * 
 */
app.post('/v1/builder/image',(req,res, next) => {
        var projectName = req.body.projectName;
        var tagName = req.body.tagName;
        var data = {
            projectName : projectName,
            tagName: tagName
        };
        jobs.createQueue('push',data);        
        next();
});

/*
 * 이미지 푸쉬 API 호출 후 내부적으로 호출되는 미들웨어
 * 
 */
app.post('/v1/builder/image',(req,res) => {
         var projectName = req.body.projectName;
    
        request(queueUrl+'/job/search?q='+projectName, function(error, response, body){ //현재 이미지 푸쉬 중인 Job 의 ID를 가져온다다
            
            if(error != undefined){
            
            logger.error('[Docker Image Builder] ERROR - Push Job Queue Search:', error); 
            logger.error('[Docker Image Builder] ERROR - Push Job Queue Search_statusCode:', response && response.statusCode); 
            logger.error('[Docker Image Builder] ERROR - Push Job Queue Search_body:', response.body);
            
            }
            var result = JSON.parse(body);
            
            var returnVal = {
                task: 'PushImage',
                status: 'ok',
                value: result[result.length-1]
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
app.get('/v1/builder/build',(req, res) => {
     
     request(dockerUrl+'/v1.24/images/json?filters=%7B%22label%22%3A%7B%22io.openshift.s2i.build.image%22%3Atrue%7D%7D', function(error, response, body){ //빌더VM의 로컬 이미지 목록중 실제 빌드한 이미지목록
            
            if(error != undefined){ 
            
            logger.error('[Docker Image Builder] ERROR - Registry List:', error); 
            logger.error('[Docker Image Builder] ERROR - Registry List_statusCode:', response && response.statusCode); 
            logger.error('[Docker Image Builder] ERROR - Registry List_body:', response.body);
            
            }
            
            var returnVal = {
                task: 'BuildImageList',
                status: 'ok',
                value: JSON.parse(response.body)
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
app.get('/v1/builder/build/:id/log',(req, res) => {
    request(queueUrl+'/job/'+req.params.id+'/log', function(error, response, body){
            
            if(error != undefined){
            logger.error('[Docker Image Builder] ERROR - Job Log:', error); 
            logger.error('[Docker Image Builder] ERROR - Job Log_statusCode:', response && response.statusCode); 
            logger.error('[Docker Image Builder] ERROR - Job Log_body:', response.body);
             }

            res.setHeader("Content-Type", "application/json");
            var returnVal = {
                task: 'buildLog_'+req.params.id,
                status: 'ok',
                value: JSON.parse(response.body)
            };
            //res.send({'status':'log','msg':response.body});      
            res.setHeader("Content-Type", "application/json");
            res.send(returnVal);
        
    });  
});

/*
 * 이미지 빌드 및 푸쉬에 대한 진행 현황을 체크하는 API(HTTP GET)
 * 크게 RUNNING / FINISHED / FAILED 3가지 상태로 나뉨
 * 
 */
app.get('/v1/builder/progress/:id',(req, res) => {
   
   jobs.progressQueue(req.params.id, res);    
   
});

/*
 * Registry 에 푸쉬된 이미지들의 목록 조회 API(HTTP GET)
 * 
 */
app.get('/v1/builder/image',(req, res) => {
    
   request(dockerRegistryUrl+'/v2/_catalog', function(error, response, body){
            if(error != undefined){
              
              logger.error('[Docker Image Builder] ERROR - /v1/builder/image:', error); 
              logger.error('[Docker Image Builder] ERROR - /v1/builder/image statusCode:', response && response.statusCode); 
              logger.error('[Docker Image Builder] ERROR - /v1/builder/image body:', response.body);
              
            }
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
                
                request(dockerRegistryUrl+'/v2/'+data+'/tags/list', function(error, response, body){
                    tagArray.push(JSON.parse(response.body));
                     if(tagArray.length == imageArray.length){ //마지막까지 다 담았으면 Response 를 보내야 함
                          res.send({'task':'RegistryList','status':'ok','value': tagArray});   
                     }
                });
            });
    });  
   
});

app.listen(3000, () => {
  logger.info('[Docker Image Builder] INFO - DockerImageBuilder API Server Start.. listening on port 3000!');
});

function validateToken(err, result, res, next) {
  if(err != undefined){
       return res.status(401).json({ status: "error", msg: 'Unauthorized' });
  }else{
      if(result.items.length <= 0){
       return res.status(400).json({ status: "error", msg: 'Wrong Namespace' });   
      }else{
      logger.info( '[Docker Image Builder] INFO - Token Validation Completed.. Pass URI...');
      next();
      }
  }
}
