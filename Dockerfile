FROM 10.0.50.31:5000/builder_base

RUN mkdir -p /usr/src/app
ENV NODE_ENV="production"
# set a health check
HEALTHCHECK --interval=5s \
            --timeout=5s \
            CMD curl -f http://127.0.0.1:3000 || exit 1
WORKDIR /            
RUN git clone http://st001:tpfla0516!@10.0.10.250:8000/st001/dockerImageBuilder.git
RUN mv /dockerImageBuilder /usr/src/app/
WORKDIR /usr/src/app/dockerImageBuilder
ONBUILD RUN npm install && npm cache clean --force 
CMD [ "npm", "start" ]
