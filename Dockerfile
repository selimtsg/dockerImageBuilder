FROM registry.auto.go.kr:31365/builder_base
RUN rm -rf /etc/localtime && ln -s /usr/share/zoneinfo/Asia/Seoul /etc/localtime
RUN npm install -g pm2
RUN mkdir -p /usr/src/app
ENV NODE_ENV="production"
# set a health check
HEALTHCHECK --interval=5s \
            --timeout=5s \
            CMD curl -f http://127.0.0.1:3000/v1 || exit 1
WORKDIR /            
RUN git clone http://st001:tpfla0516!@10.0.10.250:8000/st001/dockerImageBuilder.git
RUN mv /dockerImageBuilder /usr/src/app/
EXPOSE 3001
WORKDIR /usr/src/app/dockerImageBuilder
RUN npm install && npm cache clean --force 
RUN npm install --save winston && npm cache clean --force 
CMD [ "pm2-docker","process.yml"]
