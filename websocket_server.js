"use strict";

var http = require('http');
var https = require('https');
var fs = require('fs');
var WebSocketServer = require('websocket').server;
// const herosForRoom = {};
var heros = [];

setInterval(() => {
  // for(key in herosForRoom){
  //   heros = herosForRoom[key];
  //   if(heros && heros.length > 0){
  //     const data = {
  //       type: 'heros',
  //       heros: heros
  //     };
  //     const msg = JSON.stringify(data)
  //     connection.sendUTF(msg);
  //   }
  // }

  for(const connection of connectionArray){

    if(heros && heros.length > 0){
      const data = {
        type: 'heros',
        heros: heros
      }
  
      const msg = JSON.stringify(data)
      connection.sendUTF(msg);
    }
  }
}, 100);

// HTTPS 연결할때 사용할 SSL Key와 Certificate 파일 경로
const keyFilePath = "/etc/letsencrypt/live/turn-stun-server.kro.kr/privkey.pem";
const certFilePath = "/etc/letsencrypt/live/turn-stun-server.kro.kr/fullchain.pem";

var connectionArray = [];
var nextID = Date.now();

// 로그
function log(text) {
  var time = new Date();
  console.log("[" + time.toLocaleTimeString() + "] " + text);
}

// 허용하고 싶지 않은 origin이 있다면 이곳에서 Block
function originIsAllowed(origin) {
  return true;
}

// User 1명에게 메시지 보내기
function sendToOneUser(target, msgString) {
  var i;

  for (i=0; i<connectionArray.length; i++) {
    if (connectionArray[i].clientID == target) {
      connectionArray[i].sendUTF(msgString);
      break;
    }
  }
}

// clientID와 매칭되는 connection 가져오기
function getConnectionForID(id) {
  var connect = null;
  var i;

  for (i=0; i<connectionArray.length; i++) {
    if (connectionArray[i].clientID === id) {
      connect = connectionArray[i];
      break;
    }
  }

  return connect;
}

// 모든 사용자 리스트를 Message형태로 가져오기
function makeUserListMessage() {
  var userListMsg = {
    type: "userlist",
    users: []
  };
  var i;

  for (i=0; i<connectionArray.length; i++) {
    const connection = connectionArray[i];
    userListMsg.users.push({
        clientID : connection.clientID,
        userName : connection.username,
        room : connection.room,
        cameraOn: connection.cameraOn
    });
  }

  return userListMsg;
}

// 연결된 모든 유저들에게 현재 유저리스트를 보낸다.
function sendUserListToAll() {
  var userListMsg = makeUserListMessage();
  var userListMsgStr = JSON.stringify(userListMsg);
  var i;

  for (i=0; i<connectionArray.length; i++) {
    connectionArray[i].sendUTF(userListMsgStr);
  }
}

// function sendUserListToGroup() {
//   var userListMsg = makeUserListMessage();
//   var userListMsgStr = JSON.stringify(userListMsg);
//   var i;

//   for (i=0; i<connectionArray.length; i++) {
//     connectionArray[i].sendUTF(userListMsgStr);
//   }
// }

/**
 * https key, cert 옵션 설정
 */
var httpsOptions = {
  key: null,
  cert: null
};

try {
  httpsOptions.key = fs.readFileSync(keyFilePath);
  try {
    httpsOptions.cert = fs.readFileSync(certFilePath);
  } catch(err) {
    httpsOptions.key = null;
    httpsOptions.cert = null;
  }
} catch(err) {
  httpsOptions.key = null;
  httpsOptions.cert = null;
}

var webServer = null;

try {
  if (httpsOptions.key && httpsOptions.cert) {
    webServer = https.createServer(httpsOptions, handleWebRequest);
  }
} catch(err) {
  webServer = null;
}

// http로 webserver 생성
// if (!webServer) {
//   try {
//     webServer = http.createServer({}, handleWebRequest);
//   } catch(err) {
//     webServer = null;
//     log(`Error attempting to create HTTP(s) server: ${err.toString()}`);
//   }
// }

/**
 * WebSocket 연결 서비스는 동작 중이지만,
 * webserver는 404 페이지만 반환 하므로, 원하는 html이 있다면 작성하세요
 */
function handleWebRequest(request, response) {
  log ("Received request for " + request.url);
  response.writeHead(404);
  response.end();
}

webServer.listen(6503, function() {
  log("Server is listening on port 6503");
});

// WebSocket 서버를 생성합니다.
var wsServer = new WebSocketServer({
  httpServer: webServer,
  autoAcceptConnections: false
});

if (!wsServer) {
  log("ERROR: Unable to create WbeSocket server!");
}

/**
 * 웹소켓 connect 메시지 핸들러
 * 유저가 웹소켓에 연결될때 불러집니다.
 */
wsServer.on('request', function(request) {

  if (!originIsAllowed(request.origin)) {
    request.reject();
    log("Connection from " + request.origin + " rejected.");
    return;
  }

  // request를 Accept하고 Connection을 얻습니다.
  var connection = request.accept("json", request.origin);

  log("Connection accepted from " + connection.remoteAddress + ".");

  // Connection 추가
  connectionArray.push(connection);

  // Connection에 clientID 세팅
  connection.clientID = nextID;
  connection.cameraOn = false;

  nextID++;

  // client에게 clientID가 무엇인지 알려줍니다.
  var msg = {
    type: "id",
    id: connection.clientID
  };
  connection.sendUTF(JSON.stringify(msg));

  /**
   * client로 부터 받은 message 이벤트 핸들러
   */
  connection.on('message', function(message) {
    if (message.type === 'utf8') {
      // 모든 클라이언트에게 보낼지 유무
      var sendToClients = true;

      // 받은 메시지 parse
      msg = JSON.parse(message.utf8Data);

      if(msg.type !== 'position'){
        log("Received Message: " + message.utf8Data);
      }

      // 받은 메시지 string
      let msgString = JSON.stringify(msg);

      // 현재 소켓의 방
      const socketRoom = connection.room;
      // 새로운 방으로 가겠다는 요청
      const requestRoom = msg.room;

      // var connect = getConnectionForID(msg.id);

      /**
       * 메시지 타입에 따라 동작 구분
       */  
      switch(msg.type) {
        // 일반적인 텍스트 채팅
        case "message":
          msg.name = connection.username;
          msg.text = msg.text.replace(/(<([^>]+)>)/ig, "");
          break;

        // 사용자명 변경
        case "username":
          // connection에 userName 변경
          connection.username = msg.name;

          // 모든 유저에게 유저리스트 보내기
          sendUserListToAll();

          // 이미 보냈으므로 아래 로직 실행 막자
          sendToClients = false; 
          break;

        // remote 쪽에서 연결을 끊었다고 알려 줬을때
        case "camera-off":
          connection.cameraOn = false;
          const sender = msg.sender;
          // 상대방에게만 camera off 시킨다.
          for (i=0; i<connectionArray.length; i++) {
            const connection = connectionArray[i];
            const clientID = connection.clientID;
            if(sender !== clientID){
              connection.sendUTF(msgString);
            }
          }
          sendToClients = false; 
          break;

        case "camera-on":
          connection.cameraOn = true;
          sendToClients = false; 
          break;

        case "room-in":
          // room 없이 불렀다면, 공통 방으로
          if(!requestRoom){
            delete connection.room;
            // 모든 유저에게 유저리스트 보내기
            sendUserListToAll();
            sendToClients = false; 
            break;
          }

          // room 이 변했다면, 그떄 수정
          if(connection.room != requestRoom){
            // const prevRoom = connection.room;

            // 기존 데이터 삭제
            // delete connection.room;
            // for(let i=0; i<herosForRoom[prevRoom].length; i++){
            //   const hero = herosForRoom[prevRoom][i];
            //   if(connection.clientID === hero.clientID){
            //     herosForRoom[prevRoom].splice(i, 1);
            //     break;
            //   }
            // }

            // 새로운 방으로 추가
            // if(!herosForRoom[requestRoom]) herosForRoom[requestRoom] = [];
            // herosForRoom[requestRoom].push(connection.hero);
            connection.room = requestRoom;

            // 모든 유저에게 유저리스트 보내기
            sendUserListToAll();
          }

          sendToClients = false; 
          break;

        case "position":
          if(msg.hero){
            connection.hero.x = msg.hero.x;
            connection.hero.y = msg.hero.y;
            if(msg.hero.room) connection.hero.room = msg.hero.room;
            else delete msg.hero.room;
          }
          sendToClients = false; 
          break;

        case "create-hero":
          const msgHero = JSON.parse(msg.hero);
          const hero = {
            clientID: msgHero.clientID,
            x: msgHero.x,
            y: msgHero.y,
            room: msgHero.room
          }
          connection.hero = hero;
          heros.push(hero);
          
          // if(hero.room){
          //   if(!herosForRoom[hero.room]) herosForRoom[hero.room] = [];
          //   herosForRoom[hero.room].push(hero);
          // }else{
          //   if(!herosForRoom[undefined]) herosForRoom[undefined] = [];
          //   herosForRoom[undefined].push(hero);
          // }
          sendToClients = false; 
          break;
      }

      msgString = JSON.stringify(msg);
      // 메시지 보내기
      if (sendToClients) {
        var i;
        // target이 있다면 1명에게만 보냅니다.
        if (msg.target && msg.target !== undefined && msg.target.length !== 0) {
          sendToOneUser(msg.target, msgString);
        // 그렇지 않다면 모든 유저에게 보냅니다.
        } else {
          if(!socketRoom){
            for (i=0; i<connectionArray.length; i++) {
              if(!connectionArray[i].room){
                connectionArray[i].sendUTF(msgString);
              }
            }
          }else{
            for (i=0; i<connectionArray.length; i++) {
              if(socketRoom === connectionArray[i].room){
                connectionArray[i].sendUTF(msgString);
              }
            }
          }
          
        }
      }
    }
  });

  /**
   * 웹소켓 close 이벤트 핸들러
   * 브라우저 새로고침 또는 소켓연결이 끊겼을때 동작하게 될 것임
   */
  connection.on('close', function(reason, description) {

    const removeConnection = connection;

    // 연결된 웹소켓들만 살린다.
    connectionArray = connectionArray.filter(function(el, idx, ar) {
      return el.connected;
    });

    // 모든 사용자에게 사용자 리스트 전달
    // sendUserListToAll();
    
    const msg = JSON.stringify({
      sender : removeConnection.clientID,
      type : 'socket-close'
    });

    // hero 삭제
    heros = heros.filter(hero => hero.clientID !== removeConnection.clientID);
    // herosForRoom[connection.hero.room] = herosForRoom[connection.hero.room].filter( hero => hero.clientID !== removeConnection.clientID);
    delete connection.hero;

    // 모든 유저들에게 사라진 소켓 clientID를 보내준다.
    for (var i=0; i<connectionArray.length; i++) {
      connectionArray[i].sendUTF(msg);
    }

    // 로그 메시지 만들기
    var logMessage = "Connection closed: " + connection.remoteAddress + " (" +
                     reason;
    if (description !== null && description.length !== 0) {
      logMessage += ": " + description;
    }
    logMessage += ")";

    // 로그표시
    log(logMessage);
  });
});
