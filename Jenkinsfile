#!groovy

import groovy.json.*; // Required for parseJSON()

node {

    def app

    stage('Clone repository') {

        /* Let's make sure we have the repository cloned to our workspace */

        checkout scm

    }

    stage('Build image') {

        /* This builds the actual image; synonymous to

         * docker build on the command line */
         docker.withServer('tcp://10.0.50.11:2375') {

                app = docker.build("registry.auto.go.kr:31365/dockerimagebuilder",'--no-cache .')
        }
    }

    stage('Push image') {

        /* Finally, we'll push the image with two tags:

         * First, the incremental build number from Jenkins

         * Second, the 'latest' tag.

         * Pushing multiple tags is cheap, as all the layers are reused. */

     docker.withServer('tcp://10.0.50.11:2375') {
     
         docker.withRegistry('http://registry.auto.go.kr:31365') {

            //app.push("docker${env.BUILD_NUMBER}")

            app.push()

        }
      }


    }
   
    stage ("Deploy DockerImageBuilder"){
        docker.withServer('tcp://10.0.50.31:2375'){
            try {
            sh "docker stop imagebuilder"
            sh "docker rm imagebuilder"
            sh "docker pull registry.auto.go.kr:31365/dockerimagebuilder"
                } catch (Exception _) {
                    echo "no container to stop"
                }
            docker.image('registry.auto.go.kr:31365/dockerimagebuilder').run('--name=imagebuilder -it -p 3000:3000 --net=host --restart=always')
            

        }
        
        sh("kubectl -s http://10.0.50.31:8080 delete configmap builder-config")   
        sh("kubectl -s http://10.0.50.31:8080 create configmap builder-config --from-file=config/default.yaml")        
        sh("kubectl -s http://10.0.50.31:8080 delete -f deployments/builderDeploy.yaml")        
        sh("kubectl -s http://10.0.50.31:8080 apply -f deployments/builderDeploy.yaml")        
         
        
    }
   /*  
    stage ("Test DockerImageBuilder is Healthy"){
      timeout(time: 20, unit: 'SECONDS') { 
        def workspacePath = pwd()
        def checkUrl = "http://builder.auto.go.kr:31365/"   
        def response = sh(returnStdout: true, script:"curl -H \"Authorization: Bearer 1dHUMcijIowiXpwJqPsbRZ8MUJxJzTut\" -H \"Accept: application/json\" -H \"Content-type: application/json\" --retry-delay 10 --retry 50  ${checkUrl}").trim()          
        def slurper = new JsonSlurper()
        def json = slurper.parseText("${response}")
        def health = json.health
        
            if (deploymentOk(health)){
                return 0
            } else {
                return 1
            }
       }

   }
  */
}

def deploymentOk(health){
    def workspacePath = pwd()
    println "actual Health Status from json: ${health}"
    return "ok" == health
}

