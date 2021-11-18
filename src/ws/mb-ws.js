#!/usr/bin/env node

'use strict';

const fetch = require("node-fetch");
const WebSocket = require("ws");
const WebSocketAsPromised = require('websocket-as-promised');
const log = require('../helpers/logging').logger();


if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error(`error Expected 1 argument, got ${process.argv.length - 2}: ${process.argv.slice(2).join(' ')}. Make sure to execute this as createCommand in a mountebank protocol.`);
    process.exit(1);
  }

  let mbConfig = JSON.parse(process.argv[2]);
  mbConfig.callbackURL = mbConfig.callbackURLTemplate.replace(':port', mbConfig.port);

  const ws = new WebSocket.Server({
    port: mbConfig.port
  });

  log.info("Web socket plugin started")

  ws.on('connection', function open(ws, request) {
    log.info("on connection")
    ws.on('message', function incoming(data) {

      const wsReq = {
        request: Object.assign({},
          request,
          {
            message: JSON.parse(data)
          }
        )
      };
      log.debug(JSON.stringify(wsReq))
      fetch(mbConfig.callbackURL, {
        method: 'post',
        body: JSON.stringify(wsReq), //(1)
        headers: { 'Content-Type': 'application/json' },
      })
        .then(response => response.json())
        .then(mbResponse => {
          if (mbResponse.proxy) {
            let request = mbResponse.request.message;
            if (request.request_id) {
              log.info("[proxy] [%1$s] <-- %2$s ", request.request_id, JSON.stringify(request))
            } else {
              log.info("[proxy] <-- %s", JSON.stringify(request))
            }


            const wsProxy = new WebSocketAsPromised(mbResponse.proxy.to, {
              createWebSocket: () => new WebSocket(mbResponse.proxy.to, {
                cert: mbResponse.proxy.cert,
                key: mbResponse.proxy.key,
                rejectUnauthorized: false
              }),
              extractMessageData: event => event,
              packMessage: data => JSON.stringify(data),
              unpackMessage: data => JSON.parse(data),
              attachRequestId: (data, requestId) => Object.assign({ request_id: requestId }, data),
              extractRequestId: data => data && data.request_id,
            });


            wsProxy
              .open()
              .then(() => wsProxy.sendRequest(request,
                {
                  requestId: request.request_id,
                  timeout: "1000"
                }
              ))
              .then(response => {

                fetch(mbResponse.callbackURL, {
                  method: 'post',
                  body: JSON.stringify({ proxyResponse: response }), //(3)
                  headers: { 'Content-Type': 'application/json' },
                })
                  .then(response => response.json())
                  .then(() => {
                    log.info("[proxy] [%1$s] --> %2$s", response.request_id, JSON.stringify(response))
                    ws.send(JSON.stringify(response))
                  })
              })
              .then(() => wsProxy.close())
              .catch(() => {
                wsProxy.close()
              });
          } else {
            let request = JSON.parse(data)

            if (request.request_id) {
              mbResponse.response.request_id = request.request_id
              log.info("[%1$s] <-- %2$s", request.request_id, data)
              log.info("[%1$s] --> %2$s", request.request_id, JSON.stringify(mbResponse.response))
            } else {
              log.info("<-- %s", data)
              log.info("--> %s", JSON.stringify(mbResponse.response))
            }
            ws.send(JSON.stringify(mbResponse.response));
          }
        });
    });

    ws.on('close', function close() {

    });
  });
}