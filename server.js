const https = require('https'); 
const fs = require('fs');
const path = require('path');
const express = require('express');
const PORT = 9091
const get_SSL_options = function () {
    return {
        key: fs.readFileSync(path.resolve("/etc/letsencrypt/live/turn-stun-server.kro.kr/privkey.pem")),
        cert: fs.readFileSync(path.resolve("/etc/letsencrypt/live/turn-stun-server.kro.kr/fullchain.pem"))
    }
}


const app = express();
app.use('/static', express.static(path.join(__dirname, 'public')))

const server = https.createServer(get_SSL_options(), app);

app.use('/test', (req, res) => {
	res.sendFile(__dirname + "/index.html")
});

// app.use('/test2', (req, res) => {
// 	res.send("<h1>Hello W</h1>")
// });

server.listen(PORT, function(){ 
    console.log('Server is running...');
});