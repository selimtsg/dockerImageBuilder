var exports = module.exports = {};
if(process.env.NODE_ENV == 'develop'){
    process.env.NODE_CONFIG_DIR = './dockerImageBuilder/config'
}else{
process.env.NODE_CONFIG_DIR = './config'
}
var Redis = require('ioredis');
var config = require('config').get('dbConfig');
var redis = new Redis(config.get("redis.port"), config.get("redis.host"));
var kue = require('kue')
//docker redis > docker run -d -it --name builder_queue_store -p 6379:6379 -v /mnt/redis:/data redis redis-servers--appendonly yes
  , queue = kue.createQueue({
      prefix: 'q',
      redis: {
          port: config.get("redis.port"),
          host: config.get("redis.host"),
          db: 3
      },
      disableSearch: false
      
  });
kue.app.listen(3001);  
var job;
var cmd = require('node-cmd');
var { spawn } = require('child_process');
var Docker = require('dockerode');
var docker = new Docker({host: config.get("remoteDocker.host"), port:config.get("remoteDocker.port")});
var completeCount = 0;

/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Build 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
 */
queue.process('build',function(param, done){
    
    buildSpawn(param.data, done);
    
});

/*
 * Job 이 Queue 에 적재되면 해당 Function 이 Trigger 된다
 * 실제 이미지 Push 를 실행하는 Function 을 호출하며 최대 10개까지
 * 병렬로 수행된다
 */
queue.process('push',function(param, done){
    
    imagePush(param.data, done);
    
});

/*
 * Job Error 발생 시 발생하는 이벤트
 * ToDo : Error 가 발생한 Job 을 Queue 에서 삭제하던지 다시 실행
 *        시킬지 결정해야 함
 */
queue.on( 'error', function( err ) {
  console.log( 'Queue Error.. Reason : ', err );
});

/*
 * 실제 Build Function. node-cmd 모듈로 Async 하게 S2I 를 실행한다  
 * ToDo : Build 가 성공한 이미지를 Registry 로 Push 하는 기능 추가해야함
 */

function build(buildData, done){
    var dockerUrl = " -U tcp://"+buildData.dockerUrl+" ";    
    var cmd_snippet = "s2i build --loglevel 4 "+dockerUrl;
    console.log(cmd_snippet+buildData.project+" "+buildData.builderImage+" "+buildData.projectName);
    cmd.get(
    cmd_snippet+buildData.project+" "+buildData.builderImage+" "+buildData.projectName,
    function(err, data, stderr){            
            if(!err){
                job.progress(100,100);
                console.log('the current dir contains these files :\n\n',stderr);
                done();
            }else{
                console.log("ERR!!!!:"+err);
                done();
            }
        }
    );
    job.progress(10,100);    
}

/*
 * 실제 Build Function(Streaming Output Ver.). spawn 모듈로 Async 하게 S2I 를 실행한다  
 * ToDo : Build 가 성공한 이미지를 Registry 로 Push 하는 기능 추가해야함
 */
function buildSpawn(buildData, done){
    var dockerUrl = "tcp://"+buildData.dockerUrl;
    var base_cmd = "s2i";
    var cmd_array = ["build", "--loglevel","4", "-U", dockerUrl, buildData.project, buildData.builderImage, buildData.projectName];
    var child = spawn(base_cmd,cmd_array);
    child.stderr.on("data", (data) => {
           job.log(data);
    });
    child.on('exit', function (code, signal) {
            job.progress(100,100);    
            done();
            console.log('child process exited with ' +
                  `code ${code} and signal ${signal}`);
            });
    job.progress(10,100);    
}

/*
 * Build 가 완료된 Image 를 Push 하는 Function
 * 
 */
function imagePush(pushData, done){
  const buildImage = docker.getImage(pushData.projectName);
  console.log(buildImage);  
  buildImage.push({
      tag: "latest"
  },(error, response) => {
     if (error)
          return console.log('push', error);
     response.on('data', function(data) {
          job.progress(10,100);
          var json = JSON.parse(data.toString());
          console.log(json)
      });
      response.on('end', function(data) {
          //var json = JSON.parse(data.toString());
          // console.log(json)          
          console.log("Image Push...");
          job.progress(100,100);
          done();
      });
      
  });
}

/*
 * 5분에 한번씩 찌꺼기 Job(Complete 되었으나 Queue 에서 삭제되지 않은것들)
 * 을 지워주는 Function
 * 
 */
function cleanupQueue(){
    kue.Job.rangeByState( 'complete', 0, 100, 'asc', function( err, jobs ) {
      jobs.forEach( function( job ) {
        job.remove( function(){
          console.log( 'removed ', job.id );
        });
      });
    });
}

/*
 * 요청받은 인자로 S2I 이미지 빌드를 실행하는 Job 을 생성한다. 
 * Job 의 정보는 REDIS 에 적재된다 
 */
exports.createQueue = function(flag, data){
    var id = "";
     job = queue.create(flag, data).priority('high').searchKeys( ['projectName'] ).save(function(err){
        if(!err)console.log("Current ID::::"+id);
    });
}



/*
 * Return 된 Job ID 를 가지고 현재 빌드가 진행중인지(0 or 10)/완료인지(100)
 * Progress 값을 리턴한다. 완료시에는 Queue 에서 Job 을 제거한다
 */
exports.progressQueue = function(id, res){
    kue.Job.get(id, function (err, job) {
         console.log("err::"+err);
         console.log("Progress Job Checking....id :"+id);
         console.log("Progress Job::"+JSON.stringify(job));
           var returnVal = {
                task: 'progress',
                status: 'ok',
                values: ''
            };
            res.setHeader("Content-Type", "application/json");
         if(job == undefined){ //undefined 는 Queue 에서 삭제됐기때문(Complete 만 삭제됨)
              returnVal.values = "FINISHED";
              res.send(returnVal);                      
         }else{
               completeCount = job._progress;
               console.log("completeCount::"+completeCount);
             if(completeCount < 100){
                returnVal.values = "RUNNING";
                res.send(returnVal);   
             }
             else if(completeCount >= 100){
                returnVal.values = "FINISHED";
                res.send(returnVal);        
             }
         }
    });    

}

/*
 * 1분에 한번씩 Queue 를 정리한다
 */
setInterval(cleanupQueue, 1000*60);

