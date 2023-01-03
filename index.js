const http = require('http');
let url = require('url'); url = require('url');
const axios = require("axios");
const fs = require("fs");
const yaml = require("js-yaml");
let config = yaml.load(fs.readFileSync("./config.yml", "utf8"));
const log4js = require('log4js');
const logger = log4js.getLogger("[MAIN]");
logger.level = config.loggerLevel;

const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

process.on("uncaughtException", function(err) {
    logger.error(err);
})

let RAMCache = {};
let STORAGECache = {};

console.info("______ __________                 _____ ______                _____");
console.info("___  //_/__  ___/_____  _________ __  /____  /_ _____ ___________(_)________");
console.info("__  ,<   _____ \\ __  / / /__  __ \\_  __/__  __ \\_  _ \\__  ___/__  / __  ___/");
console.info("_  /| |  ____/ / _  /_/ / _  / / // /_  _  / / //  __/_(__  ) _  /  _(__  )");
console.info("/_/ |_|  /____/  _\\__, /  /_/ /_/ \\__/  /_/ /_/ \\___/ /____/  /_/   /____/");
console.info("                 /____/");
    

(async () => {
    if (config.configRealtimeLoad) {
        while(1) {
            await sleep(config.configLoadInterval);
            config = yaml.load(fs.readFileSync("./config.yml", "utf8"));
            logger.debug("Load config FILE");
        }
    }
})();


(async () => { // RAMCache ttl Task
    if (config.RAMCache.switch) {
        logger.info(`RAMCache DO Reset => ${Object.keys(RAMCache).length} items`)
        RAMCache = {};
        await sleep(config.RAMCache.ALLttl);
    }
})();

async function audioQuery(text, type, speed, pitch, timeout) {
    logger.debug(`Request to audioQuery | method:POST | ${text}`);
    let audioQueryData = await axios.post(encodeURI(config.audioQuery.location.replace("{text}", text).replace("{type}", type)), {
        timeout: timeout
    }).catch((error) => {
        if (error.response) {
            logger.error(error.response.status)
            return error.response.status;
        }
        if (error.code == "ECONNABORTED") return "timeout";
        logger.error(error);
        return null;
    });
    audioQueryData = audioQueryData.data;
    audioQueryData["speedScale"] = speed;
    audioQueryData["pitchScale"] = pitch;
    return audioQueryData;
}

async function synthesis(audioQueryData, type, timeout) {
    logger.debug(`Request to synthesis | method:POST |`);
    response = await axios.post(config.synthesis.location.replace("{type}", type), audioQueryData, {
        timeout: timeout,
        responseType: 'arraybuffer'
    }).catch((error) => {
        if (error.response) {
            logger.error(error.response.status)
            return error.response.status;
        }
        if (error.code == "ECONNABORTED") return "timeout";
        logger.error(error);
        return null;
    });
    return response.data;
}

const server = http.createServer(async (req, res) => {
    let text = url.parse(req.url, true).query.text, type = url.parse(req.url, true).query.type, speed = url.parse(req.url, true).query.speed, pitch = url.parse(req.url, true).query.pitch;
    if (!text) {
        res.writeHead(500);
        res.end("{\"status\":\"error\"");
        return;
    }
    if (!type) type = 8;
    if (!speed) speed = 1.1;
    if (!pitch) pitch = 0;
    logger.debug(`Request to KSynthesis | method:GET | ${req.url}`);

    if (config.RAMCache.switch) {
        if (Object.keys(RAMCache).length > config.RAMCache.maxLength) {
            logger.info(`RAMCache DO Reset => ${Object.keys(RAMCache).length} items`)
            RAMCache = {};
        }
        if (text in RAMCache) {
            if (RAMCache[text].type == type && RAMCache[text].speed == speed && RAMCache[text].pitch == pitch) {
                logger.debug(`Response to Client from Cache | ${text} |`);
                res.writeHead(200);
                res.write(RAMCache[text].synthesisData);
                res.end();
                return;
            } 
        }
    }

    let audioQueryData;
    for (let num = 0; num < config.audioQuery.retryCount; num++) { //voice task // 再試行あり
        audioQueryData = await audioQuery(text, type, speed, pitch, config.audioQuery.timeOut);
        if (!audioQueryData || audioQueryData == "timeout" || audioQueryData == 500) {
            await sleep(config.audioQuery.retryInterval);
            continue;
        }
        break;
    }
    if (!audioQueryData || audioQueryData == "timeout" || audioQueryData == 500) {
        res.writeHead(500);
        res.end("{\"status\":\"error\"");
        return;
    }

    let synthesisData
    for (let num = 0; num < config.synthesis.retryCount; num++) { //voice task // 再試行あり
        synthesisData = await synthesis(audioQueryData, type, config.synthesis.timeOut);
        if (!synthesisData || synthesisData == "timeout" || synthesisData == 500) {
            await sleep(config.synthesis.retryInterval);
            continue;
        }
        break;
    }
    if (!synthesisData || synthesisData == "timeout" || synthesisData == 500) {
        res.writeHead(500);
        res.end("{\"status\":\"error\"");
        return;
    }
    if (config.RAMCache.switch) {
        if (!(text in RAMCache)) {
            RAMCache[text] = {
                synthesisData: synthesisData,
                type: type,
                speed: speed,
                pitch: pitch
            }
        }
    }
    logger.debug(`Response to Client | ${text} |`);
    res.writeHead(200);
    res.write(synthesisData);
    res.end();
});

server.listen(config.listen.port, config.listen.host, () => {
    logger.info("KBalancer Start UP - "+server.address().address+":"+ + server.address().port);
});