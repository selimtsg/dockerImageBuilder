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
var config = require('config').get('dbConfig');
var kue = require('kue')
//docker redis > docker run -d -it --name builder_queue_store -p 6379:6379 -v /mnt/redis:/data redis redis-servers--appendonly yes
  , queue = kue.createQueue({
      prefix: 'q',
      
      redis: {
          port: config.get("redis.port"),
          host: config.get("redis.host"),
          db: 8
      },
      /*redis: {
          createClientFactory: function () {
             return new Redis.Cluster([{
             host: config.get("redis.host"),
             port: 6379
         }]);
        }

      },  */    
      disableSearch: false
      
  });
var job = new Object();
var cmd = require('node-cmd');
var { spawn } = require('child_process');
var Docker = require('dockerode');
var docker = new Docker({host: config.get("remoteDocker.host"), port:config.get("remoteDocker.port")});
var completeCount = 0;
var doneContext;

kue.app.listen(3001);
    
/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Build 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
*/
queue.process('build',10,function(param, done){
       /*
         * 실제 Build Function(Streaming Output Ver.). spawn 모듈로 Async 하게 S2I 를 실행한다  
         * ToDo : Build 가 성공한 이미지를 Registry 로 Push 하는 기능 추가해야함
         */
       /* 
        job = param;
        doneContext = done;
        job.progress(10,100);
        buildSpawn(param.id, param.data);*/   
        logger.info("[Docker Image Builder] INFO - Build Process Start....");
        job = param;
        doneContext = done;
        var dockerUrl = "tcp://"+param.data.dockerUrl;
        var base_cmd = "s2i";
        var cmd_array = ["build","--loglevel","1", "-U", dockerUrl, param.data.project, param.data.builderImage, param.data.projectName];
        var child = spawn(base_cmd,cmd_array); 
        job.progress(10,100);
        console.log(child);
        child.stdout.on("data", (data) => {
            job.progress(10,100);    
            kue.Job.get(param.id, function(err, selectedjob){
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
                kue.Job.get(param.id, function(err, selectedjob){
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
    
        
});

/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Push 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
*/
queue.process('push',10,function(param, done){

    /*
     * Build 가 완료된 Image 를 Push 하는 Function
     * 
     */
      logger.info("[Docker Image Builder] INFO - Push Image Process Start....");
      job = param;
      doneContext = done;
      job.progress(10,100);
        /*imagePush(param.data);*/
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
        
});

/*
 * Job Error 발생 시 발생하는 이벤트
 * ToDo : Error 가 발생한 Job 을 Queue 에서 삭제하던지 다시 실행
 *        시킬지 결정해야 함
*/
queue.on( 'error', function( err ) {
  logger.error( '[Docker Image Builder] ERROR - Queue Object... Reason : ', err );
});


/*
 * 실제 Build Function. node-cmd 모듈로 Async 하게 S2I 를 실행한다  
 * ToDo : Build 가 성공한 이미지를 Registry 로 Push 하는 기능 추가해야함
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
 * ToDo : Build 가 성공한 이미지를 Registry 로 Push 하는 기능 추가해야함
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
 * 
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
          console.log( '[Docker Image Builder] INFO - Queue Removed. ID is : '+ job.id );  
        });
      });
    });
}

/*
 * 요청받은 인자로 S2I 이미지 빌드를 실행하는 Job 을 생성한다. 
 * Job 의 정보는 REDIS 에 적재된다 
 */
exports.createQueue = function(flag, data){
    queue.create(flag, data).searchKeys( ['projectName'] ).priority('high').save(function(err){     
         
    });
    //logger.info(job);
}



/*
 * Return 된 Job ID 를 가지고 현재 빌드가 진행중인지(0 or 10)/완료인지(100)
 * Progress 값을 리턴한다. 완료시에는 Queue 에서 Job 을 제거한다
 */
exports.progressQueue = function(id, res){
    console.log("id:::"+id);
    kue.Job.get(id, function (err, job) {
          console.log("err:::"+err);
          res.setHeader("Content-Type", "application/json");
         //console.log('[Docker Image Builder] INFO - Job Information::'+JSON.stringify(job));
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
           /*returnVal.values = "RUNNING";
           res.send(returnVal); */  
         }
         
        }
        
    });    

}

/*
 * 5분에 한번씩 Queue 를 정리한다
 */
setInterval(cleanupQueue, 1000*60*5);
