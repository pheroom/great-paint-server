const express = require('express')
const app = express()
const WSServer = require('express-ws')(app)
const aWss = WSServer.getWss()
const cors = require('cors')
const low = require('lowdb')
const PORT = process.env.PORT || 5000
const fs = require('fs')
const path = require('path')
const {v4: uuid} = require('uuid')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('.data/db.json')
const db = low(adapter)

db.defaults({canvases: []}).write();

app.use(cors())
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true, parameterLimit: 50000}));

const index = {};

app.ws('/', (ws, req) => {
    ws.on('message', (msg) => {
        msg = JSON.parse(msg)
        const canvasId = msg.id
        switch (msg.method) {
            case "connection":
                const userId = uuid()
                const canvas = db.get('canvases').find({ id: canvasId }).value()
                if(!canvas) {
                    ws.send(JSON.stringify({method: 'error', code: 2404, msg: "Холста с таким id не существует"}))
                }
                if(
                    (canvas.painterCode && msg.code === canvas.painterCode)
                    || (canvas.spectatorCode && msg.code === canvas.spectatorCode)
                    || !canvas.spectatorCode
                ){
                    if(!index[canvasId]) index[canvasId] = {}
                    if(!canvas.painterCode || msg.code === canvas.painterCode) {
                        ws.painter = true
                    }
                    ws.userId = userId
                    index[canvasId][userId] = ws
                    ws.send(JSON.stringify({method: 'get-user-id', userId, isPainter: ws.painter}))
                    console.log('connect: ', msg.username, '-', userId, '-', ws.painter, ' total: ', Object.values(index[canvasId]).length)
                    for(let [id, client] of Object.entries(index[canvasId])){
                        client.send(JSON.stringify({method: 'connection', username: msg.username, userId}))
                    }
                } else{
                    ws.send(JSON.stringify({method: 'error', code: 2403, msg: "Неверный код для полотна"}))
                }
                break
            case "leave":
                if(index[canvasId] && index[canvasId][ws.userId]) {
                    console.log('leave: ', msg.username, '-', ws.userId, ' total: ', Object.values(index[canvasId]).length-1)
                    delete index[canvasId][ws.userId]
                    ws.close()
                }
                break
            case "draw":
                if(!ws.painter){
                    ws.send(JSON.stringify({method: 'error', code: 2402, msg: "Код для рисования не получен"}))
                    break
                }
                if(!index[canvasId]) {
                    ws.send(JSON.stringify({method: 'error', code: 2404, msg: "Холста с таким id не существует"}))
                    break
                }
                for(let client of Object.values(index[canvasId])){
                    client.send(JSON.stringify({...msg, userId: ws.userId}))
                }
                break
        }
    })
})

app.get('/canvas-confines', (req, res) => {
    try {
        const canvas = db.get('canvases').find({ id: req.query.id }).value()
        if(!canvas) {
            return res.status(404).json('Холста с таким id не существует')
        }
        const spectatorCodeNeed = canvas.spectatorCode !== ''
        const painterCodeNeed = canvas.painterCode !== ''
        res.json({spectatorCode: spectatorCodeNeed, painterCode: painterCodeNeed, name: canvas.name})
    } catch (e) {
        console.log(e)
        return res.status(500).json('Internal Server Error')
    }
})

app.post('/create-canvas', (req, res) => {
    try {
        const canvasData = req.body
        const canvasId = uuid()
        db.get('canvases').push({id: canvasId, ...canvasData}).write()
        return res.status(200).json({id: canvasId})
    } catch (e) {
        console.log(e)
        return res.status(500).json('Internal Server Error')
    }
})

app.post('/image', (req, res) => {
    try {
        const canvas = db.get('canvases').find({ id: req.query.id }).value()
        if(!canvas) {
            return res.status(404).json('Холста с таким id не существует')
        } else if(canvas.painterCode !== '' ) {
            if(!index[req.query.id] || !index[req.query.id][req.query.userId] || !index[req.query.id][req.query.userId].painter){
                return res.status(403).json('Отказанно в записе снимка приватного холста')
            }
        }
        const data = req.body.img.replace(`data:image/png;base64,`, '')
        fs.writeFileSync(path.resolve(__dirname, 'files', `${req.query.id}.jpg`), data, 'base64')
        return res.status(200).json({message: `Снимок холста успешно загружен на сервер`})
    } catch (e) {
        console.log(e)
        return res.status(500).json('Internal Server Error')
    }
})
app.get('/image', (req, res) => {
    try {
        const canvas = db.get('canvases').find({ id: req.query.id }).value()
        if(!canvas) {
            return res.status(404).json('Холста с таким id не существует')
        } else if(canvas.spectatorCode !== '') {
            if(!index[req.query.id] || !index[req.query.id][req.query.userId]){
                return res.status(403).json('Отказанно в доступе к снимку приватного холста')
            }
        }
        const imgPath = path.resolve(__dirname, 'files', `${req.query.id}.jpg`)
        if (fs.existsSync(imgPath)) {
            const file = fs.readFileSync(imgPath)
            const data = `data:image/png;base64,` + file.toString('base64')
            res.json(data)
        }else{
            res.json(null)
        }
    } catch (e) {
        console.log(e)
        return res.status(500).json('Internal Server Error')
    }
})

app.listen(PORT, () => console.log(`server started on PORT ${PORT}`))
