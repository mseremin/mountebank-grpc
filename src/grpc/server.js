'use strict'

// mock calls for grpc

const grpc = require('@grpc/grpc-js');
const transform = require('./transform')
const metadata = require('./metadata')
const log = require('../helpers/logging').logger();


const createRequest = () => {
    return {
        peer: undefined,
        path: undefined,
        canceled: undefined,
        value: undefined,
        metadata: {
            initial: undefined,
            trailing: undefined
        }
    }
};


const getUnaryRequest = (call) => {
    const t = (d) => transform.bufferToBase64(d);
    const request = createRequest();
    request.peer = call.getPeer();
    request.canceled = call.canceled;
    request.value = t(call.request);
    request.metadata.initial = t(call.metadata.getMap());
    call.on('status', status => {
        request.metadata.trailing = t(status.metadata.getMap())
    });
    return request;
};

const getStreamRequest = (call) => {
    const t = (d) => transform.bufferToBase64(d);
    const request = createRequest();
    request.peer = call.getPeer();
    request.canceled = call.canceled;
    request.metadata.initial = t(call.metadata.getMap());
    return new Promise((resolve) => {
        call.on('data', (data) => {
            request.value = t(data);
            resolve(request);
        });
        call.on('status', status => {
            request.metadata.trailing = t(status.metadata.getMap())
        });
    });
};


const sendUnaryResponse = (response, call, callback) => {
    const t = (d) => transform.bufferToBase64(d);
    const error = t(response.error)
    const value = t(response.value)
    const md = t(response.metadata)
    const mtd = (md && md.trailing) ? metadata.mapToMetadata(md.trailing) : new grpc.Metadata()
    
    if (md && md.initial) {
        call.sendMetadata(metadata.mapToMetadata(md.initial));
    }

    if (error) {
        return callback({
            code: grpc.status[error.status || 'INTERNAL'],
            message: error.message || 'error message',
            metadata: mtd
        });
    } else {
        return callback(null, value, mtd);
    }
};


const sendStreamResponse = (response, call, path) => {
    const t = (d) => transform.bufferToBase64(d);
    const error = t(response.error),
        value = t(response.value) || [],
        md = t(response.metadata);

    if (md && md.initial) {
        call.sendMetadata(metadata.mapToMetadata(md.initial));
    }

    if (error) {
        call.emit('error', {
            code: grpc.status[error.status || 'INTERNAL'],
            message: error.message || 'error message',
            metadata: (md && md.trailing) ? metadata.mapToMetadata(md.trailing) : undefined
        });
        return;
    } else {
        value.forEach(v => call.write(v));
    }
    
    if (!String(path).includes("Trading")
     && !String(path).includes("BrokerPortfolioService/getStreamV2")
     && !String(path).includes("BrokerPortfolioService/getStreamV3")
     && !String(path).includes("ShowcaseService/subscribeShowcase")) {
        call.end((md && md.trailing) ? metadata.mapToMetadata(md.trailing) : undefined);
    }
    

};


module.exports = {
    getStreamRequest,
    getUnaryRequest,
    sendStreamResponse,
    sendUnaryResponse,
    createRequest
}
