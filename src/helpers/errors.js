class ProtoError extends Error {
    constructor(filesName, additionalError = '') {
        super(`Could not loading a proto file "${filesName}". Have you added a path with vendor's proto files to request? \n Error message: ${additionalError}`);
    }
}

module.exports = {
    ProtoError
}