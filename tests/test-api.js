"use strict";

const request = require('supertest');
const app = require('../app');
const api = request(app);
const test = require('tape');

var dummyData = {
    project : "https://github.com/openshift/ruby-hello-world",
    builderImage : "centos/ruby-22-centos7",
    projectname : "hello-world-3"
}

test('Build User Image Test',t => {
    
    api
       .post('/builder/build')
       .expect('Content-Type',/json/)
       .send(dummyData)
       .end((err, res) => {
           const data = res.body.status;
           t.equals(data, true, '제대로 빌드 작업 시작됨');
           t.end();
          
       });
});