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

  log.info("on init")

  ws.on('connection', function open(ws, request) {
    let interval = {};
    log.info("on connection")
    ws.on('message', function incoming(data) {

      const wsReq = {
        request: Object.assign({},
          request,
          {
            message: data
          }
        )
      };
      fetch(mbConfig.callbackURL, {
        method: 'post',
        body: JSON.stringify(wsReq), //(1)
        headers: { 'Content-Type': 'application/json' },
      })
        .then(response => response.json())
        .then(mbResponse => {
          if (mbResponse.proxy) {
            log.info("[proxy] <-- " + mbResponse.request.message)

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

            let req = JSON.parse(mbResponse.request.message);

            wsProxy
              .open()
              .then(() => wsProxy.sendRequest(req,
                {
                  requestId: req.request_id,
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
                    log.info("[proxy] --> " + JSON.stringify(response))
                    ws.send(JSON.stringify(response))
                  })
              })
              .then(() => wsProxy.close())
              .catch(() => {
                wsProxy.close()
              });
          } else {
            log.info("<-- " + data)
            //todo обогощать request_id

            log.info("--> " + JSON.stringify(mbResponse.response))
            ws.send(JSON.stringify(mbResponse.response));
          }
        });
    });

    ws.on('close', function close() {
      for (const runningInterval in interval) {
        if (interval.hasOwnProperty(runningInterval)) {
          clearInterval(interval[runningInterval]);
        }
      }
    });

    console.log("Web socket plugin started");
  });
}