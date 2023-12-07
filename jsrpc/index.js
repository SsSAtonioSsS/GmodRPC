const Koa = require('koa');
const Router = require('koa-router');
const bodyparser = require('koa-bodyparser')
const sUID = new (require('short-unique-id'))({length: 10});
const { EventEmitter } = require('events');
const { Rcon } = require('rcon-client');
const msgpack = require('msgpack-lite');

const app = new Koa();
const router = new Router();
const eventEmitter = new EventEmitter();

// Мап для хранения статуса каждого UUID
const uuidPool = new Map();

router.post('/callback', async (ctx) => {
    const { uuid, result } = ctx.request.body;
    if(!markUuidAsCompleted(uuid, result)) {
        ctx.status = 401
        ctx.body = 'Invalid UUID'
        return
    };

    ctx.status = 200;
    ctx.body = 'Received';
});

router.post('/send', async (ctx) => {
  const { type, functionName, args } = ctx.request.body;
    if (type !== 'function') {
        if (functionName === 'lua_run')
        {
            ctx.status = 401
            ctx.body = 'lua_run not allowed!'
            return
        }
        const data = typeof args === 'object' ? Object.values(args).join(' ') : args
        
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

  // Помечаем UUID как начатый
    markUuidAsStarted(uuid);

    try {
        // Отправляем команду rfunc с UUID
        const finalResult = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout exceeded'));
        }, 30000);

        // Ожидаем завершения операции
        eventEmitter.once(`operationComplete:${uuid}`, (result) => {
            clearTimeout(timeoutId);
            resolve(result);
        });
        sendToGMOD(true, uuid, functionName, args).catch(reject)
        });
        
        // Отправка результата клиенту
        ctx.status = 200;
        ctx.body = { result: finalResult };
    } catch (error) {
        // Обработка ошибки таймаута
        ctx.status = 504; // Gateway Timeout
        ctx.body = 'Timeout exceeded';
    } finally {
        // Оповещение о завершении операции и удаление UUID из Map
        markUuidAsCompleted(uuid);
    }
});

// Маршрут для проверки статуса UUID
router.get('/uuid-status/:uuid', (ctx) => {
    const uuid = ctx.params.uuid;
    const status = getUuidStatus(uuid);
    ctx.status = status ? 200 : 404;
    ctx.body = status ? 'Executing' : 'Not exists...';
});

app.use(bodyparser());
app.use(router.routes()).use(router.allowedMethods());

app.listen(8081, '192.168.50.50', () => {
    console.log('Сервер запущен на порту 8081');
});

async function sendToGMOD(isFunc, uuid, functionName, args) {
    const rcon = new Rcon({
        host: '192.168.50.50',
        port: 27015,
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
    // Оповещаем клиента о завершении операции
    eventEmitter.emit(`operationComplete:${uuid}`, result);
    return true
}

function getUuidStatus(uuid) {
    return uuidPool.has(uuid);
}