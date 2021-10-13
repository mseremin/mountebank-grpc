FROM node:14.15.4-slim
CMD ["node"]
ENV MOUNTEBANK_VERSION=2.4.0
RUN npm -g config set user root
RUN npm install -g mountebank@${MOUNTEBANK_VERSION} --production
RUN npm install -g mountebank-grpc-mts@0.3.0 --production
RUN npm install longjohn
RUN ls -la /usr/local/lib
RUN ls -la /usr/local/bin
RUN ls -la /usr/bin
RUN ls -la /usr/local/lib/node_modules
RUN npm cache clean -f
RUN echo '{"grpc": {"createCommand": "node --max-old-space-size=8192 -r longjohn /usr/local/bin/mb-grpc"}}' > /protocols.json
EXPOSE 2525
ENTRYPOINT ["mb"]
CMD ["start", "--protofile", "/protocols.json"]