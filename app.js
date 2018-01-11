/*eslint-disable no-else-return */
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
//process.setMaxListeners(15);
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
var adminToken = require('config').get('token.admin.value');
var async = require('async');
var net = require('net');
app.use(bodyParser.json());

/*
 * Kubernete token Validates API(HTTP Filter)
 * 사용자 Token를 1차 체크 후 namespace 내에 serviceaccount 존재 여부로 2차 체크 함
 */

/*app.use(function(req, res, next) {
      
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
            
            ext.namespaces.serviceaccounts('').get((err,result) => validateToken(err, result, res, next));
            
        }
      }
  
});*/

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
 * 이미지 빌드 API 호출 
 * 
 */
app.post('/v1/builder/build/:buildconfig',(req,res) => {
    var buildconfigId = req.params.buildconfig;
    var namespace = req.headers.namespace; 
    const crd_buildconfig = new Api.CustomResourceDefinitions({
              url: kubernetesUrl,
              insecureSkipTlsVerify: true,
              group: 'stable.k8s.io',
              auth: {
                     bearer: adminToken
              },
              namespace: namespace,
              resources: ['buildconfigs']  // Notice pluralization!
        });   
    
                
        if(crd_buildconfig == undefined){
            
             return res.status(401).json({ status: "error", msg: 'Unauthorization' });
             
        }else{
            crd_buildconfig.ns.buildconfigs(buildconfigId).get((err,result) => applyBuild(err, result, res, adminToken, namespace));
            
        }
    
});

app.post('/v1/builder/pullAllNodes/:buildconfig',(req,res) => {
    
        //var token = req.headers.authorization;
        var buildconfigId = req.params.buildconfig;
        var namespace = req.headers.namespace; 
        //token = token.split("Bearer ")[1];
        //let buff = new Buffer(token, 'base64');  
        //let decodetoken = buff.toString('ascii');
        var data = {
            token : adminToken
            };    
       const crd_buildconfig = new Api.CustomResourceDefinitions({
              url: kubernetesUrl,
              insecureSkipTlsVerify: true,
              group: 'stable.k8s.io',
              auth: {
                     //bearer: decodetoken
                     bearer: adminToken
              },
              namespace: namespace,
              resources: ['buildconfigs']  // Notice pluralization!
        });   
    
                
        if(crd_buildconfig == undefined){
            
             return res.status(401).json({ status: "error", msg: 'Unauthorization' });
             
        }else{   
       //jobs.pullAllNodes(data, res);
       crd_buildconfig.ns.buildconfigs(buildconfigId).get((err,result) => applyPullAllNodes(err, result, res, adminToken, namespace));
       
       }

});


/*
 * 이미지 푸쉬 API(HTTP POST)
 * 2017.12.21 현재 Build Task 에 포함됨
 */
/*app.post('/v1/builder/image',(req,res, next) => {
        var projectName = req.body.projectName;
        var tagName = req.body.tagName;
        var data = {
            projectName : projectName,
            tagName: tagName
        };
        jobs.createQueue('push',data);        
        next();
});*/

/*
 * 이미지 푸쉬 API 호출 후 내부적으로 호출되는 미들웨어
 * 2017.12.21 현재 Build Task 에 포함됨
 */
/*app.post('/v1/builder/image',(req,res) => {
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
});*/

/*
 * 빌드된 이미지 목록을 가져오는 API(HTTP GET)
 * ToDo : 빌드된 이미지가 푸쉬가 됬는지 안됬는지 분류 필요
 * 2017.12.21 현재 Kubernetes Image 객체로 대체됨
 */
/*app.get('/v1/builder/build',(req, res) => {
     
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
});*/

/*
 * 이미지 빌드에 관련된 로그를 가져오는API(HTTP GET)
 * 해당 로그는 이미지 빌드 완료시 삭제된다.
 * Decision : 이미지빌더에서 로그를 영구보관해야하는지 결
 * 2017.12.21 현재 사용하지 않음
 */
/*app.get('/v1/builder/build/:id/log',(req, res) => {
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
});*/

/*
 * 이미지 빌드 및 푸쉬에 대한 진행 현황을 체크하는 API(HTTP GET)
 * 크게 RUNNING / FINISHED / FAILED 3가지 상태로 나뉨
 * 
 */
/*app.get('/v1/builder/progress/:id',(req, res) => {
   
   jobs.progressQueue(req.params.id, res);    
   
});*/

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

/*function validateToken(err, result, res, next) {
    
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
}*/

function applyBuild(err, result, res, token, namespace) {

    if(result.spec == undefined || result.spec == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong BuildConfig' });
    }else if(result.spec.gitUrl == undefined || result.spec.gitUrl == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong gitUrl' });   
    }else if(result.spec.builderImage == undefined || result.spec.builderImage == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong builderImage' });   
    }else if(result.spec.serviceImage == undefined || result.spec.serviceImage == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong serviceImage' });   
    }else if(result.spec.tagName == undefined || result.spec.tagName == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong tagName' });   
    }
    
    logger.info('[Docker Image Builder] INFO - GIT URL > ' + result.spec.gitUrl);
    logger.info('[Docker Image Builder] INFO - Builder Image > ' + result.spec.builderImage);
    logger.info('[Docker Image Builder] INFO - Service Image >  ' + result.spec.serviceImage);
    logger.info('[Docker Image Builder] INFO - Tag Name > ' + result.spec.tagName);
    
    const crd_builds = new Api.CustomResourceDefinitions({
              url: kubernetesUrl,
              insecureSkipTlsVerify: true,
              group: 'stable.k8s.io',
              auth: {
                     bearer: token
              },
              namespace: namespace,
              resources: ['buildses']  // Notice pluralization!
        }); 
    var qsName = 'buildconfig='+result.metadata.name;
    crd_builds.ns.buildses.get({ qs: {labelSelector: qsName}},function(buildsErr, buildsResult){
              if(buildsErr != undefined){
                  return res.status(400).json({ status: "error", msg: 'Error Retreive Builds' }); 
              }
              var len = 1;
              var generateId = "";
              logger.info(buildsResult.items);
              if(buildsResult.items.length > 0){
                  logger.info("buildsResult.items.length >>"+buildsResult.items.length);
                  len = buildsResult.items.length+1;
                  logger.info("len >> "+len);
              }
              
              generateId = result.metadata.name+"-builds-"+len; // 규칙 : 네임스페이스-서비스명-buildconfig;
              logger.info(generateId);
              var data = {
                                 projectId: result.metadata.name,
                                 project: result.spec.gitUrl,
                                 builderImage: result.spec.builderImage,
                                 projectName: result.spec.serviceImage+":"+result.spec.tagName,
                                 tagName: result.spec.tagName,
                                 dockerUrl: config.get("remoteDocker.host")+":"+config.get("remoteDocker.port"),
                                 token: token,
                                 namespace: namespace,
                                 buildConfigId: result.metadata.name,
                                 buildsId: generateId
                          };
              
              jobs.createQueue('build',data, res);
      });



}

function applyPullAllNodes(err, result, res, token, namespace) {
    logger.info(err);
    if(result.spec == undefined || result.spec == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong BuildConfig' });
    }else if(result.spec.serviceImage == undefined || result.spec.serviceImage == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong serviceImage' });   
    }else if(result.spec.tagName == undefined || result.spec.tagName == ""){
        return res.status(400).json({ status: "error", msg: 'Wrong tagName' });   
    }
    
    logger.info('[Docker Image Builder] INFO - Service Image >  ' + result.spec.serviceImage);
    logger.info('[Docker Image Builder] INFO - Tag Name > ' + result.spec.tagName);
    
              var data = {
                                 serviceImage: result.spec.serviceImage+":"+result.spec.tagName,
                                 token: token,
                                 namespace: namespace,
                                 imageId: result.metadata.name,
                                 tagName: result.spec.tagName
                          };
              jobs.pullAllNodes(data, res);



}
