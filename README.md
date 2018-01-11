# Docker-Image-Builder

## 준비사항

* Docker Remote Host -> dockerd -H tcp://0.0.0.0:2375 설정 필요(모든 Kubernetes Node 에 설정)

* Kubernetes Admin Token 및 URL, Docker Registry URL -> config 폴더 밑 default.yaml 에 정의

* Redis 는 Container 형태가 아닌 Binary 로 설치(Container 로도 테스트해봐야함)

* Builder Base Image -> builder-base.tar 로드

* Yona 에 등록한 BuildConfig/Builds/Image CustomResourceDefinition 을 사전에 꼭 만들 것