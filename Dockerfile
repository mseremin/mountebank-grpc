FROM node:14.15.4-slim
CMD ["node"]
ENV MOUNTEBANK_VERSION=2.4.0
RUN npm -g config set user root
RUN npm install -g mountebank@${MOUNTEBANK_VERSION} --production
RUN npm install -g mountebank-grpc-mts@0.2.43 --production
RUN npm cache clean -f
RUN echo '{"grpc": {"createCommand": "mb-grpc"}}' > /protocols.json
EXPOSE 2525
ENTRYPOINT ["mb"]
CMD ["start", "--protofile", "/protocols.json"]