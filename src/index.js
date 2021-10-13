'use strict'

// main entry point
const constants = require('./constants')
const grpc = require('@grpc/grpc-js');
const mock = require('./mock')
const logging = require('./helpers/logging')
const log = logging.logger()
const net = require('net')


const main = () => {
    const config = JSON.parse(process.argv[2]),
        placeholder = net.createServer((sock) => { sock.end('placeholder'); });

    logging.setLogLevel(config.loglevel || constants.LOGGING.INFO.LEVEL);

    // use placeholder server to bind port, then close -> start gRPC server with same port
    placeholder.listen(config.port || 0, () => {
        const port = placeholder.address().port;
        placeholder.close(() => {
            const serverInstance = mock.getServerInstance(Object.assign(config, {'port': port}));
            serverInstance.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => {
                serverInstance.start();
                let metadata = {
                    'port': port,
                    'encoding': 'utf8',
                    'services': config.services
                }
                log.debug(JSON.stringify(metadata));
                log.info(`server started on port '%s'`, port);
            });
        });
    });
}

module.exports = { main };
