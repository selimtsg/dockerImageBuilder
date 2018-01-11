var exports = module.exports = {};

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

if(process.env.NODE_ENV == 'develop'){
    process.env.NODE_CONFIG_DIR = './dockerImageBuilder/config'
}else{
process.env.NODE_CONFIG_DIR = './config'
}
const Api = require('kubernetes-client');
var Redis = require('ioredis');
var config = require('config').get('dbConfig');
var async = require('async');
var kubernetesUrl = 'https://'+config.get("kubernetes.host")+":"+config.get("kubernetes.port");
var kue = require('kue')
//docker redis > docker run -d -it --name builder_queue_store -p 6379:6379 -v /mnt/redis:/data redis redis-servers--appendonly yes
  , queue = kue.createQueue({
      prefix: 'q',
      
      redis: {
          port: config.get("redis.port"),
          host: config.get("redis.host"),
          db: 2,
          options: {
              no_ready_check: true
          }
         /*createClientFactory: function () {
                return new Redis.Cluster([{
                  host: config.get("redis.host"),  
                  port: 7000
                }, {
                  host: config.get("redis.host"),  
                  port: 7001
                }, {
                  host: config.get("redis.host"),  
                  port: 7002
                }, {
                  host: config.get("redis.host"),  
                  port: 7003
                }, {
                  host: config.get("redis.host"),  
                  port: 7004
                }, {
                  host: config.get("redis.host"),  
                  port: 7005
                }, {
                  host: config.get("redis.host"),  
                  port: 7006
                }, {
                  host: config.get("redis.host"),  
                  port: 7007
                }
                ]);
         }*/

      },
      disableSearch: false
      
  });
var job = new Object();
var cmd = require('node-cmd');
var { spawn } = require('child_process');
var Docker = require('dockerode');
var docker = new Docker({host: config.get("remoteDocker.host"), port:config.get("remoteDocker.port")});
var doneContext;

kue.app.listen(3001);
    
/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Build 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
*/


/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Push 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
 * 2017.12.20 현재 Build Task 에 포함되어 아래 프로세스는 사용하지 않는다. 추후 Task 변경이 있을경우엔 사용
*/
/*queue.process('push',10,function(param, done){

    
     * Build 가 완료된 Image 를 Push 하는 Function
     * 
     
      logger.info("[Docker Image Builder] INFO - Push Image Process Start....");
      job = param;
      doneContext = done;
      job.progress(10,100);
     
      const buildImage = docker.getImage(param.data.projectName);
      const tagName = param.data.tagName;
      logger.info('[Docker Image Builder] INFO - Launched Push Image..');
      buildImage.push({
          tag: tagName,
          authconfig: {} 
      },(error, response) => {
         if (error){
              job.progress(99,100);
              doneContext(new Error("Image Push Failed"));
              return logger.error('push', error);
              }
         response.on('data', function(data) {
              job.progress(10,100);
              logger.info( '[Docker Image Builder] INFO - Push Logs : '+ data.toString());
          });
          response.on('end', function(data) {
              logger.info( '[Docker Image Builder] INFO - Image Push Completed');
              job.progress(100,100);
              doneContext();
              cleanupQueue();
          });
          
      });
        
});*/

/*
 * Job Error 발생 시 발생하는 이벤트
 * ToDo : Error 가 발생한 Job 을 Queue 에서 삭제하던지 다시 실행
 *        시킬지 결정해야 함
*/
queue.on( 'error', function( err ) {
  logger.error( '[Docker Image Builder] ERROR - Queue Object... Reason : ', err );
});


/*
 *  실제 Build Function. node-cmd 모듈로 Async 하게 S2I 를 실행한다  
 *  2017.12.20 현재 job.process 메소드 내에 통합되어 아래 메소드는 사용하지 않는다. 추후 Task 변경이 있을경우엔 사용
 */
/*
function build(jobid, buildData, done){
    var dockerUrl = " -U tcp://"+buildData.dockerUrl+" ";    
    var cmd_snippet = "s2i build --loglevel 1 "+dockerUrl;
    console.log(cmd_snippet+buildData.project+" "+buildData.builderImage+" "+buildData.projectName);
    cmd.get(
    cmd_snippet+buildData.project+" "+buildData.builderImage+" "+buildData.projectName,
    function(err, data, stderr){            
            if(!err){
                job.progress(100,100);
                logger.info( '[Docker Image Builder] INFO - Build... ');
                done();
            }else{
                logger.error( '[Docker Image Builder] ERROR - Queue Object... Reason : '+err );
                done();
            }
        }
    );
    job.progress(10,100);    
}*/

/*
 * 실제 Build Function(Streaming Output Ver.). spawn 모듈로 Async 하게 S2I 를 실행한다  
 * 2017.12.20 현재 job.process 메소드 내에 통합되어 아래 메소드는 사용하지 않는다. 추후 Task 변경이 있을경우엔 사용
 */
/*function buildSpawn(jobid, buildData){
    var dockerUrl = "tcp://"+buildData.dockerUrl;
    var base_cmd = "s2i";
    var cmd_array = ["build", "-U", dockerUrl, buildData.project, buildData.builderImage, buildData.projectName];
    var child = spawn(base_cmd,cmd_array); 
    job.progress(10,100);
    child.stdout.on("data", (data) => {
        job.progress(10,100);    
        kue.Job.get(jobid, function(err, selectedjob){
            //logger.info('[Docker Image Builder] INFO - Build Logs STDOUT JobID: '+JSON.stringify(selectedjob));
            logger.info( '[Docker Image Builder] INFO - Build Logs STDOUT : '+ data );
            if(data.search("error") > -1 || data.search("ERROR") > -1 || data.search("exit") > -1 || data.search("failed") > -1){
                    job.progress(99,100);    
                    doneContext(new Error('Build Failed'));                    
            }
            //selectedjob.log('[Docker Image Builder] INFO - Build Logs : '+data.toString());
        });

    });
    child.stderr.on("data", (data) => {
            job.progress(10,100);    
            kue.Job.get(jobid, function(err, selectedjob){
            //logger.info('[Docker Image Builder] INFO - Build Logs STDERR JobID: '+JSON.stringify(selectedjob));
            logger.info( '[Docker Image Builder] INFO - Build Logs STDERR : '+ data );
            if(data.search("error") > -1 || data.search("ERROR") > -1 || data.search("exit") > -1 || data.search("failed") > -1){
                    job.progress(99,100);    
                    doneContext(new Error('Build Failed'));                    
            }
            //selectedjob.log('[Docker Image Builder] INFO - Build Logs : '+data.toString());
           });

    });
    child.on('error', function (err) {
            job.progress(99,100);    
            doneContext(new Error('Build Failed'));
            logger.error( '[Docker Image Builder] ERROR - Build Failed.. Reason ::'+err);
            cleanupQueue();   
    });
    child.on('exit', function (code, signal) {
            job.progress(100,100);    
            doneContext();
            logger.info( '[Docker Image Builder] INFO - Build Done ');
            cleanupQueue();
    });
    
}*/

/*
 * Build 가 완료된 Image 를 Push 하는 Function
 * 2017.12.20 현재 Build Task 에 통합되어 아래 메소드는 사용하지 않는다. 추후 Task 변경이 있을경우엔 사용
 */
/*function imagePush(pushData){
  const buildImage = docker.getImage(pushData.projectName);
  const tagName = pushData.tagName;
  logger.info('[Docker Image Builder] INFO - Launched Push Image..');
  buildImage.push({
      tag: tagName,
      authconfig: {} 
  },(error, response) => {
     if (error){
          doneContext(new Error("Image Push Failed"));
          return logger.error('push', error);
          }
     response.on('data', function(data) {
          job.progress(10,100);
          logger.info( '[Docker Image Builder] INFO - Push Logs : '+ data.toString());
      });
      response.on('end', function(data) {
          logger.info( '[Docker Image Builder] INFO - Image Push Completed');
          job.progress(100,100);
          doneContext();
          cleanupQueue();
      });
      
  });
}*/

/*
 * 1분에 한번씩 찌꺼기 Job(Complete 되었으나 Queue 에서 삭제되지 않은것들)
 * 을 지워주는 Function
 * 
 */
function cleanupQueue(){
    kue.Job.rangeByState( 'complete', 0, 100, 'asc', function( err, jobs ) {
      jobs.forEach( function( job ) {
        job.remove( function(){
          logger.info( '[Docker Image Builder] INFO - Queue Removed. ID is : '+ job.id );  
          
        });
      });
    });
}

/*
 * 요청받은 인자로 S2I 이미지 빌드를 실행하는 Job 을 생성한다. 
 * Job 의 정보는 REDIS 에 적재된다 
 */
exports.createQueue = function(flag, data, res){
    queue.create(flag, data).searchKeys( ['projectName'] ).ttl(1000*60).save(function(err){
         queue.process('build',10,function(param, done){
       /*
         * 실제 Build Function(Streaming Output Ver.). spawn 모듈로 Async 하게 S2I 를 실행한다. 이미지 빌드가 성공하면 곧바로 이미지 푸쉬를 실행한다
         * 이미지 빌드가 성공하더라도 이미지 푸쉬가 실패하면 해당 빌드는 실패로 처리한다 
         * Kubernetes Builds 객체의 Status 값 : Ready/Building/Pushing/Failed/Completed
         * Todo >> Builds 에 대한 버전관리를 해야함. 똑같은 BuildConfig를 빌드하면 builds-1->builds-2->builds-3.. 형식으로 Builds를 쌓아야함
         */
     
        logger.info("[Docker Image Builder] INFO - Build Process Start....");
        job = param;
        doneContext = done;
        var dockerUrl = "tcp://"+param.data.dockerUrl;
        var base_cmd = "s2i";
        var cmd_array = ["build","--loglevel","1", "-U", dockerUrl, param.data.project, param.data.builderImage, param.data.projectName];
        var child = spawn(base_cmd,cmd_array); 
        var cnt = 0;
        //job.progress(10,100);
        var d = new Date(); // Kubernetes Builds 객체의 상태값과 더불어 실행일시를 업데이트 하기위한 Date 객체
        var months = d.getMonth()+1;
        var days = d.getDate();
        var hours = d.getHours();
        var minutes = d.getMinutes();
        var seconds = d.getSeconds();
        
        if(months < 10){
            months = "0"+d.getMonth()+1; // 10월 이하는 앞에 0을 붙여준다
        }
        if(days < 10){
            days = "0"+d.getDate()+1; // 10일 이하는 앞에 0을 붙여준다
        }
        if(hours < 10){
            hours = "0"+d.getHours(); // 10시 이하는 앞에 0을 붙여준다
        }
        if(minutes < 10){
            minutes = "0"+d.getMinutes(); // 10분 이하는 앞에 0을 붙여준다
        }
        if(seconds < 10){
            seconds = "0"+ d.getSeconds(); // 10초 이하는 앞에 0을 붙여준다
        }
        var startDate = d.getFullYear()+"-"+months+"-"+days+"T"+hours+":"+minutes+":"+seconds+"Z";
        /*child.stdout.on("data", (data) => {
            
            job.progress(10,100);
            var d = new Date();
            var fullDate = d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()+"_"+d.getHours()+":"+d.getMinutes()+":"+d.getSeconds();
            const buildsactor = new Api.CustomResourceDefinitions({
              url: kubernetesUrl,
              insecureSkipTlsVerify: true,
              group: 'stable.k8s.io',
              auth: {
                     bearer: job.data.token
              },
              namespace: job.data.namespace,
              resources: ['buildses']  // Notice pluralization!
            }); 
                        
            kue.Job.get(param.id, function(err, selectedjob){
                logger.info( '[Docker Image Builder] INFO - Build Logs STDOUT : '+ data );
                var succ_patch = {
                                  apiVersion: "stable.k8s.io/v1",
                                  kind: "Builds",
                                  metadata:{
                                     name: job.data.buildsId,
                                     namespace: job.data.namespace,
                                     resourceVersion: "5583316"
                                  },
                                  spec: {
                                      gitUrl: param.data.project,
                                      builderImage: param.data.builderImage,
                                      serviceImage: param.data.projectName,
                                      tagName: param.data.tagName,
                                      status: "Running", 
                                      creDttm: fullDate
                                      }
                                  };
                var err_patch = {
                                  apiVersion: "stable.k8s.io/v1",
                                  kind: "Builds",
                                  metadata:{
                                     name: job.data.buildsId,
                                     namespace: job.data.namespace,
                                     resourceVersion: "5583316"
                                  },
                                  spec: {
                                      gitUrl: param.data.project,
                                      builderImage: param.data.builderImage,
                                      serviceImage: param.data.projectName,
                                      tagName: param.data.tagName,
                                      status: "Failed", 
                                      creDttm: fullDate
                                      }
                                  };
                    if(data.indexOf("error") > -1 || data.indexOf("ERROR") > -1 || data.indexOf("exit") > -1 || data.indexOf("failed") > -1){
                         buildsactor.ns.buildses(param.data.buildsId).put({body: err_patch}, function(err, result){
                            if(err != undefined){
                                logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Patched...");
                                job.progress(99,100);    
                                doneContext(new Error('Build Failed'));
                            }else{
                                logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                                job.progress(99,100);    
                                doneContext(new Error('Build Failed'));
                            }
                        });
                         
                    }
                    buildsactor.ns.buildses(param.data.buildsId).put({body: succ_patch}, function(err, result){
                        if(err != undefined){
                            logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Patched...");
                        }else{
                            logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                        }
                    });
            
             });

        });*/
       /*
        * S2i 가 실행되고 나서 아웃풋이 발생할때마다 아래의 이벤트가 발동된다
        * 
        */
        child.stderr.on("data", (data) => {
                /*
                 * Kubernetes 에 미리 정의되어 있는 커스텀 객체인 Builds 를 컨택하기 위한 생성자 buildsactor
                 * 
                 */
                const buildsactor = new Api.CustomResourceDefinitions({
                  url: kubernetesUrl,
                  insecureSkipTlsVerify: true,
                  group: 'stable.k8s.io',
                  auth: {
                         bearer: job.data.token
                  },
                  namespace: job.data.namespace,
                  resources: ['buildses']  // Notice pluralization!
                  });                  
                 kue.Job.get(param.id, function(err, selectedjob){
                    /*
                     * 2017.12.20 현재 Kubernetes 의 객체를 PATCH 메소드를 통해 업데이트가 불가능한 버그가 있어
                     * 삭제후 생성방식으로 진행하고 있음. 아래의 patch 객체는 생성할 Buils 객체의 Template 임
                     * Builds 의 spec 하위의 status 를 상황에 따라 동적으로 변경하여 생성함
                     * 
                     */
                    var patch = {
                                  apiVersion: "stable.k8s.io/v1",
                                  kind: "Builds",
                                  metadata:{
                                     name: job.data.buildsId,
                                     namespace: job.data.namespace,
                                     labels:{
                                      buildconfig: job.data.buildConfigId
                                     }
                                     
                                  },
                                  spec: { 
                                      serviceImage: param.data.projectName,
                                      tagName: param.data.tagName,
                                      status: "Building", 
                                      creDttm: startDate,
                                      endDttm: ""
                                      }
                                  };
                    //logger.info('[Docker Image Builder] INFO - Build Logs STDERR JobID: '+JSON.stringify(selectedjob));
                    logger.info( '[Docker Image Builder] INFO - Build Logs STDERR : '+ data );
                    if(data.indexOf("error") > -1 || data.indexOf("ERROR") > -1 || data.indexOf("exit") > -1 || data.indexOf("failed") > -1){ // S2i 의 아웃풋중 에러메시지가 체크되면 빌드 실패로 전환해야함
                        
                        buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){ // 기존 Builds 객체 삭제
                            
                            patch.spec.status = "Failed"; // Builds 객체의 status를 실패로 재정의
                            patch.spec.endDttm = getCurrentTime(); // Builds 객체의 종료시점 정의의
                            buildsactor.ns.buildses(param.data.buildsId).post({body: patch}, function(err, result){ // Build 실패가 정의된 Builds 객체 생성
                            if(err != undefined){
                                logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Created...");
                                //job.progress(99,100);    
                                doneContext(new Error('Build Failed'));
                                cleanupQueue();   
                            }else{
                                logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                                //job.progress(99,100);    
                                doneContext(new Error('Build Failed'));
                                cleanupQueue();   
                            }
                        });
                            
                        });                         
                         
                    }
                    if(cnt <= 1){
                         //job.progress(10,100); // 해당 job이 Running 상태임을 나타내는 상태값.. 2017.12.20 현재는 job 을 조회하지 않아 사용하지는 않지만 추후 변경가능성이 있어 남겨둠   
                         buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){
                                buildsactor.ns.buildses(param.data.buildsId).post({body: patch}, function(err, result){
                                    if(err != undefined){
                                        logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Created...");
                                        logger.error(err);                            
                                    }else{
                                        logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                                    }
                                });
                        });

                    //selectedjob.log('[Docker Image Builder] INFO - Build Logs : '+data.toString());
                    }
               });
            cnt++;
        });
        child.on('error', function (err) {
                //job.progress(99,100);                    
                var err_patch = {
                                  apiVersion: "stable.k8s.io/v1",
                                  kind: "Builds",
                                  metadata:{
                                     name: job.data.buildsId,
                                     namespace: job.data.namespace,
                                     labels:{
                                      buildconfig: job.data.buildConfigId
                                     }
                                     
                                  },
                                  spec: {
                                      serviceImage: param.data.projectName,
                                      tagName: param.data.tagName,
                                      status: "Failed", 
                                      creDttm: startDate,
                                      endDttm: getCurrentTime()
                                      }
                                  };
                const buildsactor = new Api.CustomResourceDefinitions({
                  url: kubernetesUrl,
                  insecureSkipTlsVerify: true,
                  group: 'stable.k8s.io',
                  auth: {
                         bearer: job.data.token
                  },
                  namespace: job.data.namespace,
                  resources: ['buildses']  // Notice pluralization!
                });
                buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){
                        buildsactor.ns.buildses(param.data.buildsId).post({body: err_patch}, function(err, result){
          
                                    if(err != undefined){
                                        logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Patched...나여??");
                                       // job.progress(99,100);    
                                        doneContext(new Error('Build Failed'));
                                        
                                        cleanupQueue();   
                                    }else{
                                        logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                                       // job.progress(99,100);    
                                        doneContext(new Error('Build Failed'));
                                        cleanupQueue();   
                                    }
                        });
               });               

        });
        
        /*
         * 2017년 12월 20일에 해야할 일
         * >> exit 이벤트에서 이미지 Push 하는 Task 추가해야함
         * >> 이미지 빌드가 완료되더라도 Push 가 실패하면 해당 이미지 빌드는 실패처리
         * >> Builds 객체의 Status 는 Push 완료 시점에 Completed, 기존 Completed 는 Pushing 으로 변경필요
         * 2017년 12월 20일
         * >> 이미지 빌드 성공에 한해서 이미지 푸쉬를 진행하는 로직 추가함. 테스트 필요
         */
        child.on('exit', function (code, signal) {
                //job.progress(100,100);                  
                var patch = {
                                  apiVersion: "stable.k8s.io/v1",
                                  kind: "Builds",
                                  metadata:{
                                     name: job.data.buildsId,
                                     namespace: job.data.namespace,
                                     labels:{
                                      buildconfig: job.data.buildConfigId
                                     }
                                     
                                  },
                                  spec: {
                                      serviceImage: param.data.projectName,
                                      tagName: param.data.tagName,
                                      status: "Pushing", 
                                      creDttm: startDate,
                                      endDttm: ""
                                      }
                                  };
              
                const buildsactor = new Api.CustomResourceDefinitions({
                  url: kubernetesUrl,
                  insecureSkipTlsVerify: true,
                  group: 'stable.k8s.io',
                  auth: {
                         bearer: job.data.token
                  },
                  namespace: job.data.namespace,
                  resources: ['buildses']  // Notice pluralization!
                }); 
                buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){                   
                    buildsactor.ns.buildses(param.data.buildsId).post({body: patch}, function(err, result){
                                var cnt = 0;
                                if(err != undefined){
                                    logger.error(err);
                                    logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Created...");
                                  
                                    //job.progress(100,100);    
                                    doneContext(new Error('Build Done.. But Image Push Failed'));
                                    cleanupQueue();   
                                }else{
                                    logger.info("[Docker Image Builder] INFO - "+JSON.stringify(result));
                                    const buildImage = docker.getImage(param.data.projectName);
                                    const tagName = param.data.tagName;
                                    logger.info('[Docker Image Builder] INFO - Launched Push Image..');
                                    buildImage.push({
                                        tag: tagName,
                                        authconfig: {} 
                                    },(error, response) => {
                                       if (error){
                                            logger.error("IS ERROR? >> "+error);
                                            //job.progress(99,100);
                                            patch.spec.status = "Failed";
                                            patch.spec.endDttm = getCurrentTime();
                                            buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){
                                               buildsactor.ns.buildses(param.data.buildsId).post({body: patch}, function(err, result){
                                                    if(err != undefined){
                                                        logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Created...");
                                                        //job.progress(99,100);    
                                                        doneContext(new Error('Image Push Failed'));
                                                        cleanupQueue();   
                                                    }else{
                                                        doneContext(new Error("Image Push Failed"));
                                                        cleanupQueue(); 
                                                    }
                                               }); // Builds Post End
                                            }); // Builds Delete End


                                        }// Push Error Check End
                                        
                                        response.on('data', function(data) { 
                                                 //logger.info( '[Docker Image Builder] INFO - Push Logs : '+ data.toString());                                        
                                        });
                                        
                                        response.on('end', function(data) {
                                            patch.spec.status = "Completed";
                                            patch.spec.endDttm = getCurrentTime();
                                            buildsactor.ns.buildses.delete({name: job.data.buildsId}, function(err, result){
                                               buildsactor.ns.buildses(param.data.buildsId).post({body: patch}, function(err, result){
                                                   if(err != undefined){
                                                        logger.error(err);
                                                        logger.error("[Docker Image Builder] ERROR - Kubernetes Builds Object Not Created...");
                                                        //job.progress(100,100);    
                                                        doneContext(new Error('Image Push Completed'));
                                                        cleanupQueue();   
                                                    }else{
                                                       logger.info( '[Docker Image Builder] INFO - Image Push Completed');
                                                       //job.progress(100,100);
                                                       doneContext();
                                                       cleanupQueue();
                                                       createImageObject(job.data, patch.spec.endDttm, buildImage);
                                                    } // After Post Operation End  

                                               }); // Builds Post End 
                                            }); // Builds Delete End
                                         }); // response End Event End
                                     }); //buildImage Push End                          
                                }
                    });
              });                

        });
    
        
    });
         res.send({'task':'BuildImage', 'status':'started'});
    });
    
    job.on('complete', function(result){
      console.log('Job completed with data ', result);
    
    }).on('failed attempt', function(errorMessage, doneAttempts){
      console.log('Job failed');
    
    }).on('failed', function(errorMessage){
      console.log('Job failed');
    
    }).on('progress', function(progress, data){
      console.log('\r  job #' + job.id + ' ' + progress + '% complete with data ', data );
    
    });
};
/*
 * 빌드완료된 서비스이미지를 전체 노드에 Pulling 하는 메소드.
 * 해당 API 호출 시 Image 객체의 pullAll 스테이터스를 조회함으로써 진행상황을 알 수 있음
 * 
 */
exports.pullAllNodes = function(data, res){
    
    const imageActor = new Api.CustomResourceDefinitions({
          url: kubernetesUrl,
          insecureSkipTlsVerify: true,
          group: 'stable.k8s.io',
          auth: {
                 bearer: data.token
          },
          namespace: data.namespace,
          resources: ['images']  // Notice pluralization!
        });
    imageActor.ns.images(data.imageId).get(function(getErr, getResult){
        var onFinishedCnt = 1;
        var onProgressCnt = 1;
        var template =
                                {
                                     apiVersion: "stable.k8s.io/v1",
                                      kind: "Image",
                                      metadata:{
                                         name: getResult.metadata.name,
                                         namespace: getResult.metadata.namespace,
                                         labels:{
                                          app: getResult.metadata.name
                                         }
                                         
                                      },
                                      spec:{    
                                          //result.Id
                                          imageId: getResult.spec.imageId,
                                          //result.Env
                                          env: getResult.spec.env,
                                          //result.ContainerConfig.ExposedPorts
                                          ports: getResult.spec.ports
                                          
                                      },
                                      status: {
                                          dockerImageRepository: getResult.status.dockerImageRepository,
                                          tags: getResult.status.tags,
                                          creDttm: getResult.status.creDttm,
                                      }
                                };
                   
                                
                                  const core = new Api.Core({
                                  url: kubernetesUrl,
                                  insecureSkipTlsVerify: true,
                                  auth: {
                                     bearer: data.token
                                  },
                                  promises: true,
                                  version: 'v1'
                                  });
                                  
                                  core.nodes.get().then(function(arrayOfResult){
                                       async.each(arrayOfResult.items,function(row, callback){
                                           var allDocker = new Docker({host: row.status.addresses[0].address, port:2375});
                                             allDocker.pull(data.serviceImage, {'authconfig': ''}, (err, stream) => {
                                               allDocker.modem.followProgress(stream, onFinished, onProgress);
                        
                                                function onFinished(err, output) {
                                                   
                                                    if (!err) {
                                                         logger.info('[Docker Image Builder] INFO - Partitially pulling... Current::'+onFinishedCnt);
                                                         if(onFinishedCnt == arrayOfResult.items.length){
                                                             
                                                             imageActor.ns.images.delete({name: data.imageId}, function(deleteErr, deleteResult){
                                                             let i = 0;
                                                             const iMax = template.status.tags.length;
                                                             for(; i< iMax; i++){
                                                                 if(template.status.tags[i].tag == data.tagName){
                                                                     template.status.tags[i].pullAll = "AllPulled";
                                                                 }
                                                             }
                                                             //template.status.pullAll = "AllPulled";
                                                                imageActor.ns.images(data.imageId).post({body: template}, function(postErr, postResult){
                                                                     logger.info("[Docker Image Builder] INFO - allPullNodes done");
                                                                     return true;
                                                                });
                                                            });
                                                          }
                                                          onFinishedCnt++;
                                                    } else {
                                                        logger.info(err);
                                                        process.exit(1);
                                                    }
                                                }
                                                function onProgress(event){
                                                    if(onProgressCnt == 1){
                                                        logger.info('[Docker Image Builder] INFO - Change pullAll status...');
                                                        imageActor.ns.images.delete({name: data.imageId}, function(deleteErr, deleteResult){
                                                             let i = 0;
                                                             const iMax = template.status.tags.length;
                                                             for(; i< iMax; i++){
                                                                 if(template.status.tags[i].tag == data.tagName){
                                                                     template.status.tags[i].pullAll = "Pulling";
                                                                 }
                                                             }
                                                           imageActor.ns.images(data.imageId).post({body: template}, function(postErr, postResult){
                                                                     logger.info("[Docker Image Builder] INFO - pullAll status changed to pulling...");
                                                           });
                                                        });

                                                    }
                                                    onProgressCnt++;
                                                }
                                            });
                                       });
                                       return true;
                        
                                    }, function(err){
                                        logger.error(err);
                                    }).catch(console.log.bind(console));
        
    });

             
            
           res.send({'task':'pullAllNodes', 'status':'started'});
    
};



/*
 * Return 된 Job ID 를 가지고 현재 빌드가 진행중인지(0 or 10)/완료인지(100)
 * Progress 값을 리턴한다. 완료시에는 Queue 에서 Job 을 제거한다
 * 2017.12.20 현재 Kubernetes Builds 객체에 상태값을 적용하는 Task 로 변경되어 아래 메소드는 사용하지 않는다. 추후 Task 변경이 있을경우엔 사용
 */
/*exports.progressQueue = function(id, res){
    kue.Job.get(id, function (err, job) {
          res.setHeader("Content-Type", "application/json");
          var returnVal = {
                task: 'progress',
                status: 'ok',
                values: ''
            };
         if(err != undefined || err){
         
         logger.error( '[Docker Image Builder] ERROR - Progress.. Reason : '+ err );
         returnVal.values = "FINISHED";
         res.send(returnVal);   
         
         }else{

         
         if(job == undefined){ //undefined 는 Queue 에서 삭제됐기때문(Complete 만 삭제됨)
              returnVal.values = "FINISHED";
              res.send(returnVal);                      
         }else{
             
               completeCount = job.progress();
               logger.info( '[Docker Image Builder] INFO - Progress Count : '+ job.progress());
             if(job.progress() == undefined || completeCount < 99 ){
                returnVal.values = "RUNNING";
                res.send(returnVal);   
             }else if(completeCount == 99){
                returnVal.values = "FAILED";
                res.send(returnVal);
             } 
             else if(completeCount >= 100){
                cleanupQueue();
                returnVal.values = "FINISHED";
                res.send(returnVal);        
             }
           returnVal.values = "RUNNING";
           res.send(returnVal);   
         }
         
        }
        
    });    

}*/

/*
 * 현재 시간 조회
 */
function getCurrentTime(){
        var d = new Date(); // Kubernetes Builds 객체의 상태값과 더불어 실행일시를 업데이트 하기위한 Date 객체
        var months = d.getMonth()+1;
        var days = d.getDate();
        var hours = d.getHours();
        var minutes = d.getMinutes();
        var seconds = d.getSeconds();
        
        if(months < 10){
            months = "0"+d.getMonth()+1; // 10월 이하는 앞에 0을 붙여준다
        }
        if(days < 10){
            days = "0"+d.getDate()+1; // 10일 이하는 앞에 0을 붙여준다
        }
        if(hours < 10){
            hours = "0"+d.getHours(); // 10시 이하는 앞에 0을 붙여준다
        }
        if(minutes < 10){
            minutes = "0"+d.getMinutes(); // 10분 이하는 앞에 0을 붙여준다
        }
        if(seconds < 10){
            seconds = "0"+ d.getSeconds(); // 10초 이하는 앞에 0을 붙여준다
        }
        var currDate = d.getFullYear()+"-"+months+"-"+days+"T"+hours+":"+minutes+":"+seconds+"Z";
        return currDate;
}

function createImageObject(data, buildTime, buildImage){
    
    buildImage.inspect(function(err, inspect){
         //오류가 났을때는 이미지 객체 생성안함
         if(err){
             logger.error("[Docker Image Builder] ERROR - Inspect Images...Reason >> "+err);
             return false;
         }
        
         var template =
                        {
                             apiVersion: "stable.k8s.io/v1",
                              kind: "Image",
                              metadata:{
                                 name: data.buildsId.toString().split("-")[0],
                                 namespace: data.namespace,
                                 labels:{
                                  app: data.buildsId.toString().split("-")[0]
                                 }
                                 
                              },
                              spec:{    
                                  //result.Id
                                  imageId: inspect.Id,
                                  //result.Env
                                  env: inspect.Config.Env,
                                  //result.ContainerConfig.ExposedPorts
                                  ports: inspect.ContainerConfig.ExposedPorts
                                  
                              },
                              status: {
                                  dockerImageRepository: data.projectName.split(":")[0]+":"+data.projectName.split(":")[1],
                                  tags: [
                                          {
                                           tag: data.tagName,
                                           pullAll: "Ready",
                                           status: "Pushed",
                                           items: [                                                
                                            ]
                                          }
                                  ],
                                  creDttm: buildTime
                              }
                        };
          const imageActor = new Api.CustomResourceDefinitions({
                  url: kubernetesUrl,
                  insecureSkipTlsVerify: true,
                  group: 'stable.k8s.io',
                  auth: {
                         bearer: data.token
                  },
                  namespace: data.namespace,
                  resources: ['images']  // Notice pluralization!
                }); 
                
                imageActor.ns.images(data.buildsId.toString().split("-")[0]).get(function(getErr, getResult){
             
                  
                  
                  var newInnerTags = {
                                 created: buildTime,
                                 dockerImageReference: inspect.RepoDigests[0].split("@")[0]+"@"+inspect.Id,
                                 image: inspect.Id
                  };
                  
                  var newTags = {
                                  tag: data.tagName,
                                  pullAll: "Ready",
                                  status: "Pushed",
                                  items:[]
                                };
                  
                       
                  /*
                   * 최초로 만들어지는 객체는 getErr 에 Not Found 에러 내용이 담겨오기 때문에 아래의 로직 적용
                   * 
                   */
                  
                  if(getErr != undefined){                      
                          template.status.tags[0].items.unshift(newInnerTags);     
                          imageActor.ns.images.delete({name: data.buildsId.toString().split("-")[0]}, function(deleteErr, deleteResult){     
                                imageActor.ns.images(data.buildsId.toString().split("-")[0]).post({body: template}, function(postErr, postResult){
                                    
                                    if(err != undefined){
                                        logger.error("[Docker Image Builder] ERROR - Create Images Object...Reason >> "+postErr);
                                        return false;
                                    }
                                    
                                    logger.info("[Docker Image Builder] INFO - Create Image Object.. ID >> "+data.buildsId.toString().split("-")[0]);
                                    
                                });              
                       });      
                  }else{
                      /*
                       * 여기서 해야할 거
                       * 1. 새로 만든 이미지의 태그명이 기존 Image 객체에 있을때
                       * 2. 기존 Image 객체에 없을때
                       * 
                       * 둘 다 tags Array 를 새로 만들면됨(기존꺼 불러와서)
                       * 그런데 1과 2의 방법이 조금 다름
                       */
                      //1-1. 기존의 모든 태그 리스트 저장
                      var getResultArray = new Array();                     
                      getResultArray = getResult.status.tags;
                      var check = 0;
                      //1-2. 새로만든 태그가 기존 태그 리스트에 있는지 비교
                      let i = 0;
                      const iMax = getResultArray.length;
                      for(; i< iMax; i++){
                          //1-3. 태그리스트에 해당 태그가 있다면 getResultArray 내부 객체의 items 에 새로 추가된 newTags 를 unshift 하면 됨
                           if(getResultArray[i].tag == data.tagName){
                                getResultArray[i].items.unshift(newInnerTags);          
                           }else{
                               check++;
                               
                            //2-1. 없으면(== 기존이미지의 태그가 변경되었을때) getResultArray 에 새로운 tags Object   
                           }

                      }
                      if(check == getResultArray.length){
                             newTags.items.unshift(newInnerTags);
                             getResultArray.unshift(newTags);
                      }
                      template.status.tags = getResultArray;
                                      
                      imageActor.ns.images.delete({name: data.buildsId.toString().split("-")[0]}, function(deleteErr, deleteResult){     
                                imageActor.ns.images(data.buildsId.toString().split("-")[0]).post({body: template}, function(postErr, postResult){
                                    
                                    if(err != undefined){
                                        logger.error("[Docker Image Builder] ERROR - Create Images Object...Reason >> "+postErr);
                                        return false;
                                    }
                                    
                                    logger.info("[Docker Image Builder] INFO - Create Image Object.. ID >> "+data.buildsId.toString().split("-")[0]);
                                    
                                });              
                       });      
                  }  
                   

                });
                

        
    });
    
}
/*
 * 5분에 한번씩 Queue 를 정리한다
 */
setInterval(cleanupQueue, 1000*60*5);
queue.watchStuckJobs(1000);