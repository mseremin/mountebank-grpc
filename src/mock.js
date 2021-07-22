'use strict'

// mock implementation

const grpc = require('grpc')
const mb = require('./mountebank/request')
const client = require('./grpc/client')
const server = require('./grpc/server')
const service = require('./grpc/service')
const log = require('./helpers/logging').logger();
const { ProtoError } = require('./helpers/errors')

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
            server.sendStreamResponse(response, call);
        })();
    }
}


const createStreamUnaryMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return (call, callback) => {
        log.info('sending stream-unary rpc');
        const request = server.getStreamRequest(call);
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
                response = await client.sendStreamUnaryCall(clientOptions, mbResponse.request);
                log.debug(`proxy_response='%s'`, JSON.stringify(response));
                await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
            }
            server.sendUnaryResponse(response, call, callback);
        })();
    }
}


const createStreamStreamMockCall = (mbOptions, rpcinfo, clientDefinition) => {
    return (call) => {
        const request = server.getStreamRequest(call);
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
                response = await client.sendStreamStreamCall(clientOptions, mbResponse.request);
                log.debug(`proxy_response='%s'`, JSON.stringify(response));
                await mb.sendRequest(mbResponse.callbackURL, {proxyResponse: response});
            }
            server.sendStreamResponse(response, call);
        })();
    }
}


module.exports = {
    getServerInstance,
}
