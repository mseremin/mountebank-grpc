'use strict'

// mock implementation

const grpc = require('@grpc/grpc-js');
const mb = require('./mountebank/request')
const client = require('./grpc/client')
const server = require('./grpc/server')
const service = require('./grpc/service')
const log = require('./helpers/logging').logger();
const { ProtoError } = require('./helpers/errors')
const transform = require('./grpc/transform')

const getServerInstance = (config) => {
    const
        server = new grpc.Server(),
        mbOptions = {
            callbackURL: config.callbackURLTemplate.replace(':port', config.port)
        },
        serverOptions = Object.assign({}, config.options),
        defaultProtobufjsOptions = {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true
        },
        protobufjsOptions = Object.assign({}, defaultProtobufjsOptions, serverOptions.protobufjs);
    if (protobufjsOptions.includeDirs) {
        protobufjsOptions.includeDirs = Object.values(protobufjsOptions.includeDirs);
    }
    Object.entries(config.services).forEach(([key, value]) => {
        const serviceOptions = {service: key, file: value.file}

        let serviceDefinition
        let clientDefinition
        try {
            serviceDefinition = service.getServiceDefinition(serviceOptions, protobufjsOptions)
            clientDefinition = service.getClientDefinition(serviceOptions, protobufjsOptions)
        } catch (error) {
            throw new ProtoError(serviceOptions.file, error.message)
        }

        const implementation = createImplementation(mbOptions, serviceDefinition, clientDefinition)
        
        server.addService(serviceDefinition, implementation);
    })

    return server;
}


const createImplementation = (mbOptions, serviceDefinition, clientDefinition) => {
    const implementation = {}
    Object.keys(serviceDefinition).forEach(key => {
        const rpcinfo = serviceDefinition[key];
        if (!rpcinfo.requestStream && !rpcinfo.responseStream) {
            implementation[key] = createUnaryUnaryMockCall(mbOptions, rpcinfo, clientDefinition);
        } else if (!rpcinfo.requestStream && rpcinfo.responseStream) {
            implementation[key] = createUnaryStreamMockCall(mbOptions, rpcinfo, clientDefinition);
        } else if (rpcinfo.requestStream && !rpcinfo.responseStream) {
            implementation[key] = createStreamUnaryMockCall(mbOptions, rpcinfo, clientDefinition);
        } else {
            implementation[key] = createStreamStreamMockCall(mbOptions, rpcinfo, clientDefinition);
        }
    });
    return implementation;
}


const createUnaryUnaryMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return (call, callback) => {
        log.debug('sending unary-unary rpc');
        const request = server.getUnaryRequest(call);
        request.path = rpcinfo.path;
        (async () => {
            const mbResponse = await mb.sendRequest(mbOptions.callbackURL, {request: request});
            let response = mbResponse.response;
            if (!response.value) {
                response.error = {
                    status: 'INTERNAL',
                    message: `Not found stub for request ${request.path}.`,
                }
                return server.sendUnaryResponse(response, call, callback);
            }
            if (mbResponse.proxy) {
                const clientOptions = {
                    endpoint: mbResponse.proxy.to,
                    originalName: rpcinfo.originalName,
                    clientDefinition,
                };
                response = await client.sendUnaryUnaryCall(clientOptions, mbResponse.request);
                log.debug(`proxy_response='%s'`, JSON.stringify(response));
                await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
            }
            server.sendUnaryResponse(response, call, callback);
        })();
    }
}


const createUnaryStreamMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return (call) => {
        log.debug('sending unary-stream rpc');
        const request = server.getUnaryRequest(call);
        request.path = rpcinfo.path;
        (async () => {
            const mbResponse = await mb.sendRequest(mbOptions.callbackURL, {request: request});
            let response = mbResponse.response;
            if (mbResponse.proxy) {
                const clientOptions = {
                    endpoint: mbResponse.proxy.to,
                    originalName: rpcinfo.originalName,
                    clientDefinition,
                };
                response = await client.sendUnaryStreamCall(clientOptions, mbResponse.request);
                log.debug(`proxy_response='%s'`, JSON.stringify(response));
                await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
            }
            server.sendStreamResponse(response, call, request.path);
        })();
        
    }
}


// const createStreamUnaryMockCall = (mbOptions, rpcinfo, clientDefinition) => {
//     return (call, callback) => {
//         log.info('sending stream-unary rpc');
//         (async () => {
//             const request = await server.getStreamRequest(call);
//             request.path = rpcinfo.path;
//             const mbResponse = await mb.sendRequest(mbOptions.callbackURL, {request: request});
//             let response = mbResponse.response;
//             if (mbResponse.proxy) {
//                 const clientOptions = {
//                     endpoint: mbResponse.proxy.to,
//                     originalName: rpcinfo.originalName,
//                     clientDefinition,
//                 };
//                 response = await client.sendStreamUnaryCall(clientOptions, mbResponse.request);
//                 log.debug(`proxy_response='%s'`, JSON.stringify(response));
//                 await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
//             }
//             server.sendUnaryResponse(response, call, callback);
//         })();
//     }
// }


// const createStreamStreamMockCall = (mbOptions, rpcinfo, clientDefinition) => {
//     return (call) => {
//         log.info('sending stream-stream rpc');
//         (async () => {
//             const request = await server.getStreamRequest(call);
//             request.path = rpcinfo.path;
//             const mbResponse = await mb.sendRequest(mbOptions.callbackURL, {request: request});
//             let response = mbResponse.response;
//             if (mbResponse.proxy) {
//                 const clientOptions = {
//                     endpoint: mbResponse.proxy.to,
//                     originalName: rpcinfo.originalName,
//                     clientDefinition,
//                 };
//                 response = await client.sendStreamStreamCall(clientOptions, mbResponse.request);
//                 log.debug(`proxy_response='%s'`, JSON.stringify(response));
//                 await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
//             }
//             server.sendStreamResponse(response, call, request.path);
        
//         })();
//     }

// }

const createStreamStreamMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return async (call) => {
        log.info('Sending stream-stream rpc: %s', rpcinfo.path);

        const request = server.createRequest();
        request.peer = call.getPeer();
        request.canceled = call.canceled;
        request.path = rpcinfo.path;

        call.on('data', async (data) => {
            log.debug('Data incomming = %j', data);

            request.value = transform.bufferToBase64(data);
            const mbResponse = await mb.sendRequest(mbOptions.callbackURL, { request });
            await server.sendStreamResponse(mbResponse.response, call, request.path);
        });

        call.on('status', async (data) => {
            log.debug('Status incomming = %j', data);
        });

        call.on('error', async (data) => {
            log.debug('Error = %j', data);
        });

        call.on('end', async (data) => {
            log.debug('End of data');
        });

        const mbResponse = await mb.sendRequest(mbOptions.callbackURL, { request });
        await server.sendStreamResponse(mbResponse.response, call, request.path);
    }
}
const createStreamUnaryMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return async (call, callback) => {
        log.info('Sending stream-unary rpc: %s', rpcinfo.path);

        const request = server.createRequest();
        request.peer = call.getPeer();
        request.canceled = call.canceled;
        request.path = rpcinfo.path;

        call.on('data', async (data) => {
            log.debug('Data incomming = %j', data);

            request.value = transform.bufferToBase64(data);
            const mbResponse = await mb.sendRequest(mbOptions.callbackURL, { request });
            await server.sendUnaryResponse(mbOptions.response, call, callback);
        });

        call.on('status', async (data) => {
            log.debug('Status incomming = %j', data);
        });

        call.on('error', async (data) => {
            log.debug('Error = %j', data);
        });

        call.on('end', async (data) => {
            log.debug('End of data');
        });

        const mbResponse = await mb.sendRequest(mbOptions.callbackURL, { request });
        await server.sendUnaryResponse(mbOptions.response, call, callback);

    }
}


module.exports = {
    getServerInstance,
}
