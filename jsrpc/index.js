require('dotenv').config();
const { assert } = require('console');

const port = process.env.APP_PORT || 3000;
const ip = process.env.APP_IP || "127.0.0.1";
const server_ip = process.env.GM_IP;
const server_port = process.env.GM_PORT;
const uid_len = process.env.UID_LENGTH || 10;

assert(server_ip, "Gmod server ip is empty");
assert(server_port, "Gmod server port is empty");

const Koa = require('koa');
const Router = require('koa-router');
const bodyparser = require('koa-bodyparser');
const sUID = new (require('short-unique-id'))({length: uid_len});
const { EventEmitter } = require('events');
const { Rcon } = require('rcon-client');
const msgpack = require('msgpack-lite');

const app = new Koa();
const router = new Router();
const eventEmitter = new EventEmitter();

const uuidPool = new Map();

router.post('/callback', async (ctx) => {
    const { uuid, result } = ctx.request.body;
    if(!markUuidAsCompleted(uuid, result)) {
        ctx.status = 401;
        ctx.body = 'Invalid UUID';
        return;
    };

    ctx.status = 200;
    ctx.body = 'Received';
});

router.post('/send', async (ctx) => {
  const { type, functionName, args } = ctx.request.body;
    if (type !== 'function') {
        if (functionName === 'lua_run')
        {
            ctx.status = 401;
            ctx.body = 'lua_run not allowed!';
            return;
        }
        const data = typeof args === 'object' ? Object.values(args).join(' ') : args;
        
        try {
            const result = await sendToGMOD(false, undefined, functionName, data);
            ctx.status = 200;
            ctx.body = {result};
        } catch (err) {
            ctx.status = 500;
            ctx.body = err;
        }
        return
    }

    const uuid = sUID.rnd();

    markUuidAsStarted(uuid);

    try {
        const finalResult = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout exceeded'));
        }, 30000);

        eventEmitter.once(`operationComplete:${uuid}`, (result) => {
            clearTimeout(timeoutId);
            resolve(result);
        });
        sendToGMOD(true, uuid, functionName, args).catch(reject);
        });
        
        ctx.status = 200;
        ctx.body = { result: finalResult };
    } catch (error) {
        ctx.status = 504;
        ctx.body = 'Timeout exceeded';
    } finally {
        markUuidAsCompleted(uuid);
    }
});

router.get('/uuid-status/:uuid', (ctx) => {
    const uuid = ctx.params.uuid;
    const status = getUuidStatus(uuid);
    ctx.status = status ? 200 : 404;
    ctx.body = status ? 'Executing' : 'Not exists...';
});

app.use(bodyparser());
app.use(router.routes()).use(router.allowedMethods());

app.listen(port, ip, () => {
    console.log(`Server started, ${port}`);
});

async function sendToGMOD(isFunc, uuid, functionName, args) {
    const rcon = new Rcon({
        host: server_ip,
        port: server_port,
        password: 'ziLYruAXTG0FFer4',
    });

    try {
        args = args ?? (isFunc ? {} : '')
        const command = isFunc?`rfunc ${uuid} ${functionName} ${msgpack.encode(args).toString('hex')}`:`${functionName} ${args}`;
        await rcon.connect();
        return await rcon.send(command);
    } finally {
        rcon.end();
    }
}

function markUuidAsStarted(uuid) {
    uuidPool.set(uuid, 'started');
}

function markUuidAsCompleted(uuid, result) {
    if (!getUuidStatus(uuid)) return false
    uuidPool.delete(uuid);
    eventEmitter.emit(`operationComplete:${uuid}`, result);
    return true;
}

function getUuidStatus(uuid) {
    return uuidPool.has(uuid);
}