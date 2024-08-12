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
const sUID = new (require('short-unique-id'))({ length: uid_len });
const { EventEmitter } = require('events');
const { Rcon } = require('rcon-client');

const app = new Koa();
const router = new Router();
const eventEmitter = new EventEmitter();

const uuidPool = new Map();

router.post('/callback', async (ctx) => {
    const { uuid, result } = ctx.request.body;
    if (!markUuidAsCompleted(uuid, result)) {
        ctx.status = 401;
        ctx.body = 'Invalid UUID';
        return;
    };

    ctx.status = 200;
    ctx.body = 'Received';
});

router.post('/send', async (ctx) => {
    const { functionName, args } = ctx.request.body;
    if (functionName === 'lua_run') {
        ctx.status = 401;
        ctx.body = 'lua_run is forbidden, use /execlua instead!';
        return;
    }
    const data = typeof args === 'object' ? Object.values(args).join(' ') : args;

    try {
        const result = await sendToGMOD(false, undefined, functionName, data);
        ctx.status = 200;
        ctx.body = { result };
    } catch (err) {
        ctx.status = 500;
        ctx.body = err;
    }
});

router.post('/execlua', async (ctx) => {
    const { lua } = ctx.request.body;
    if (!lua || typeof lua !== 'string') {
        ctx.status = 400
        ctx.body = { msg: `\`lua\` not a string` }
        return
    }

    const uuid = sUID.rnd();
    markUuidAsStarted(uuid, lua);

    try {
        const finalResult = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout exceeded'));
            }, 30000);

            eventEmitter.once(`operationComplete:${uuid}`, (result) => {
                clearTimeout(timeoutId);
                resolve(result);
            });
            sendToGMOD(uuid).catch(reject);
        });

        ctx.status = 200;
        ctx.body = finalResult;
    } catch (error) {
        ctx.status = 504;
        ctx.body = 'Timeout exceeded';
    } finally {
        markUuidAsCompleted(uuid);
    }
})

router.get('/luastring/:uuid', (ctx) => {
    const uuid = ctx.params.uuid;

    if (!getUuidStatus(uuid)) {
        return ctx.status = 404;
    }
    ctx.status = 200;
    ctx.body = { lua: getUuidData(uuid) }
})

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

async function sendToGMOD(uuid) {
    const rcon = new Rcon({
        host: server_ip,
        port: server_port,
        password: '12345',
    });

    try {
        const command = `execlua ${uuid}`
        await rcon.connect();
        return await rcon.send(command);
    } finally {
        rcon.end();
    }
}

function markUuidAsStarted(uuid, data = 'started') {
    uuidPool.set(uuid, data);
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

function getUuidData(uuid) {
    return uuidPool.get(uuid)
}