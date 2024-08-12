require('dotenv').config();

const port = process.env.APP_PORT || 3000;
const ip = process.env.APP_IP || "127.0.0.1";
const uid_len = process.env.UID_LENGTH || 10;

const Koa = require('koa');
const Router = require('koa-router');
const bodyparser = require('koa-bodyparser');
const sUID = new (require('short-unique-id'))({ length: uid_len });
const { EventEmitter } = require('events');
const { Rcon } = require('rcon-client');
const { isIP } = require('net');

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

router.post('/rcon', async (ctx) => {
    const { cmd, rcon, ip, port } = ctx.request.body;
    if (typeof ip !== 'string' || isIP(ip) !== 4) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct IP' };
        return;
    }

    if (port < 0 || port > 65535) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct port [0-65535]' };
        return;
    }

    if (typeof rcon !== 'string' || rcon.length == 0) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct RCON password' };
        return;
    }

    if (typeof cmd !== 'string' || cmd.length === 0) {
        ctx.status = 400;
        ctx.body = { msg: 'Cmd is empty' };
        return;
    }

    if (cmd.split(' ')[0] === 'lua_run') {
        ctx.status = 401;
        ctx.body = { msg: 'lua_run is forbidden, use /execlua instead!' };
        return;
    }

    try {
        const result = await sendToGMOD(undefined, cmd, ip, port, rcon);
        ctx.status = 200;
        ctx.body = { data: result };
    } catch (err) {
        ctx.status = 500;
        ctx.body = err;
    }
});

router.post('/execlua', async (ctx) => {
    const { lua, rcon, ip, port } = ctx.request.body;

    if (typeof ip !== 'string' || isIP(ip) !== 4) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct IP' };
        return;
    }

    if (port < 0 || port > 65535) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct port [0-65535]' };
        return;
    }

    if (typeof rcon !== 'string' || rcon.length == 0) {
        ctx.status = 400;
        ctx.body = { msg: 'Specify the correct RCON password' };
        return;
    }

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
            sendToGMOD(uuid, undefined, ip, port, rcon).catch(reject);
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

async function sendToGMOD(uuid, cmd, ip, port, rcon_pwd) {
    const rcon = new Rcon({
        host: ip,
        port: port,
        password: rcon_pwd,
    });

    try {
        const command = cmd ? cmd : `execlua ${uuid}`
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