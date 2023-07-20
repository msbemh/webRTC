"use strict";

// var serverHostName = '121.157.225.115'
var serverHostName = 'turn-stun-server.kro.kr'

log("serverHostName: " + serverHostName);

// 웹소켓 connection
var connection = null;

var clientID = 0;
var userList = [];
var userListExceptMe = [];
var userMe = {};
var sameRoomUserList = [];
var sameRoomUserListExceptMe = [];

var peerConnections = {};
var localStream = null;       

// 미디어 제약사항
var mediaConstraints = {
  audio: false,            
  video: true
};

var anotherHeros;


// 로그
function log(text) {
  var time = new Date();
  console.log("[" + time.toLocaleTimeString() + "] " + text);
}

// 에러 로그
function log_error(text) {
  var time = new Date();
  console.trace("[" + time.toLocaleTimeString() + "] " + text);
}

// 메시지 서버로 보내기
function sendToServer(msg) {
  var msgJSON = JSON.stringify(msg);

  // log("Sending '" + msg.type + "' message: " + msgJSON);
  connection.send(msgJSON);
}

// 서버에도 clientID에 대한 userName을 맞추기 위해서 전달
function setUsername() {
  const username = document.getElementById("name").value;

  var context = document.getElementById('demo').getContext('2d');
  Game.run(context);

  sendToServer({
    name: username,
    date: Date.now(),
    id: clientID,
    type: "username"
  });
}

// 웹소켓 서버와 연동
function connect() {
  var serverUrl;
  var scheme = "ws";

  if (document.location.protocol === "https:") {
    scheme += "s";
  }

  serverUrl = scheme + "://" + serverHostName + ":6503";

  log(`Connecting to server: ${serverUrl}`);
  // 웹소켓 생성
  connection = new WebSocket(serverUrl, "json");

  // 웹소켓 open 핸들러
  connection.onopen = function(evt) {
    document.getElementById("text").disabled = false;
    document.getElementById("send").disabled = false;

  };

  // 웹소켓 error 핸들러
  connection.onerror = function(evt) {
    console.dir(evt);
  }

  // 웹소켓 message 핸들러
  connection.onmessage = function(evt) {
    var chatBox = document.querySelector(".chatbox");
    var text = "";

    // 메시지
    var msg = JSON.parse(evt.data);

    // log("Message received: ");
    // console.dir(msg);

    var time = new Date(msg.date);
    var timeStr = time.toLocaleTimeString();

    switch(msg.type) {
      // clientID를 받았을 때
      case "id":
        clientID = msg.id;
        document.getElementById('client_id').innerHTML = clientID;
        // 서버웹소켓에도 userName 동기화
        setUsername();
        break;

      // 서버에도 userName 잘 연동 됨
      // case "username":
      //   text = "<b>User <em>" + msg.name + "</em> signed in at " + timeStr + "</b><br>";
      //   break;

      // 채팅 메시지를 받음
      case "message":
        text = "(" + timeStr + ") <b>" + msg.name + "</b>: " + msg.text + "<br>";
        break;

      // 사용자 리스트 업데이트
      case "userlist":      
        handleUserList(msg);
        break;

      /**
       * 시그널 메시지는 비디오을 위한 협상하는 동안
       * "WebRTC 시그널 정보"를 교환하는데 이용합니다.
       */
      case "video-offer":  
        handleVideoOffer(msg);
        break;

      case "video-answer":  // Callee has answered our offer
        handleVideoAnswerMsg(msg);
        break;

      case "new-ice-candidate": // A new ICE candidate has been received
        handleNewICECandidateMsg(msg);
        break;

      // 다른 피어가 카메라를 끊었을때 불려진다.
      case "camera-off": 
        handleHangUp(msg);
        break;

      case "socket-close":
        socketClose(msg);
        break;

      case "peer-close":
        peerClose(msg.sender);
        break;

      case "heros":
        anotherHeros = [];
        for(const tempHero of msg.heros){
          if(clientID === tempHero.clientID){
            // Game.hero.x = tempHero.x;
            // Game.hero.y = tempHero.y;
          }else{
            anotherHeros.push(tempHero);
          }
        }
        
        // console.log('[히어로 위치]anotherHeros:', anotherHeros);
        break;
      // 알려지진 않은 메시지
      default:
        log_error("Unknown message received:");
        log_error(msg);
    }

    // 채팅이 있을경우, 추가 및 스크롤 내려주기
    if (text.length) {
      chatBox.innerHTML += text;
      chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
    }
  };
}

// 채팅 메시지 보내기
function handleSendButton() {
  var msg = {
    text: document.getElementById("text").value,
    type: "message",
    id: clientID,
    date: Date.now()
  };
  sendToServer(msg);
  document.getElementById("text").value = "";
}

// enter 누르면 채팅 메시지 보내기
function handleKey(evt) {
  if (evt.keyCode === 13 || evt.keyCode === 14) {
    if (!document.getElementById("send").disabled) {
      handleSendButton();
    }
  }
}

/**
 * STUN/TURN server와 상호작용하는 법을 알고 있는 RTCPeerConnection 생성
 * PeerConnectioin에 stream을 추가하자
 */
function createPeerConnection(mClientID) {
  log(`${mClientID} 의 PeerConnection 생성`);

  const peerConnection = new RTCPeerConnection({
    // ICE servers 정보 - 내가 소유한!
    iceServers: [     
      {
        urls: "turn:turn-stun-server.kro.kr?transport=tcp",
        username: "song",
        credential: "Alshalsh92@"
      }
    ]
  });

  // ICE 협상 프로세스를 위한 이벤트 핸들러 세팅
  peerConnection.onicecandidate = handleICECandidateEvent;
  peerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
  peerConnection.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
  peerConnection.onsignalingstatechange = handleSignalingStateChangeEvent;
  peerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
  peerConnection.ontrack = handleTrackEvent;

  peerConnections[mClientID] = peerConnection;

  return peerConnection;
}

// PeerConn에 대한 target client ID 가져오기
function getTargetForPeerConn(peerConnection){
  for(const key in peerConnections){
    const peerConn = peerConnections[key];
    if(peerConn === peerConnection){
      return key;
    }
  }
}

/**
 * Peer에 stream track이 추가 되면 시작됨.
 * WebRTC단에서 호출됩니다.
 * ICE 협상을 시작, 재개, 재시작
 */
async function handleNegotiationNeededEvent() {
  const peerConnection = this;
  const targetID = getTargetForPeerConn(peerConnection);
  const userName = userMe.userName;

  try {
    log("---> Creating offer");
    const offer = await peerConnection.createOffer();

    if (peerConnection.signalingState != "stable") {
      log("     -- The connection isn't stable yet; postponing...")
      return;
    }

    log("---> Setting local description to the offer");
    await peerConnection.setLocalDescription(offer);

    // 원격 피어에 Offer 보내기
    log("---> Sending the offer to the remote peer");

    sendToServer({
      name: userName,
      sender: clientID,
      type: "video-offer",
      target: targetID,
      sdp: peerConnection.localDescription
    });
  } catch(err) {
    log("*** The following error occurred while handling the negotiationneeded event:");
    reportError(err);
  };
}

/**
 * WebRTC call의 미디어 트랙에 대한 이벤트가 발생할때 WebRTC단에서 불려집니다.
 * 스트림이 추가되거나 삭제될때도 호출 됩니다.
 * 
 * RTCRtpReceiver       receiver
 * MediaStreamTrack     track
 * MediaStream[]        streams
 * RTCRtpTransceiver    transceiver
 */
function handleTrackEvent(event) {
  log("*** Track event");

  const peerConnection = this;
  const targetID = getTargetForPeerConn(peerConnection);

  if(document.getElementById('video_' + targetID)) document.getElementById('video_' + targetID).srcObject = event.streams[0];
  
}

function handleICECandidateEvent(event) {
  if (event.candidate) {
    log("*** Outgoing ICE candidate: " + event.candidate.candidate);

    const peerConnection = this;
    const targetID = getTargetForPeerConn(peerConnection);

    sendToServer({
      type: "new-ice-candidate",
      target: targetID,
      sender: clientID,
      candidate: event.candidate
    });
  }
}

/**
 * ICE Connection이 닫히거나, 연결이 끊기거나, 실패했을때 불려진다.
 * ICE Agent의 상태가 변화했을때 불려진다.
 */
async function handleICEConnectionStateChangeEvent() {
  const peerConnection = this;

  log("*** ICE connection state changed to " + peerConnection.iceConnectionState);

  switch(peerConnection.iceConnectionState) {
    case "connected":
        // debugger;
        console.log('들어옴');
        break;
    case "closed":
    case "failed":
    case "disconnected":
      const peerConnection = this;
      const targetID = getTargetForPeerConn(peerConnection);
      closeRemoteVedio(targetID);
      break;
  }
}

/**
 * 시그널링 연결이 닫혔을때 호출 됩니다.
 * 주요 : 브라우저 최신화할 때, signalingstatechange는 RTCPeerConnection.connectionState 속성에서 반환된 RTCPeerConnectionState enum으로 move할 것이다.
 */
function handleSignalingStateChangeEvent() {
  const peerConnection = this;
  log("*** WebRTC signaling state changed to: " + peerConnection.signalingState);
  switch(peerConnection.signalingState) {
    case "closed":
      closeRemoteVedio();
      break;
  }
}

/**
 * [icegatheringstatechange]
 * ICE 엔진이 동작중이라는 것을 알려줍니다.
 * "new" : 네트워킹이 아직 발생하지 않았다.
 * "gathering" : ICE 엔진이 현재 candidate들을 모으는 중이다.
 * "complete" : gathering이 완료 되었다.
 */
function handleICEGatheringStateChangeEvent() {
  const peerConnection = this;
  log("*** ICE gathering state changed to: " + peerConnection.iceGatheringState);
}

/**
 * 서버에서 사용자 리스트 받음
 */
function handleUserList(msg) {
  // 전체 사용자 목록
  userList = msg.users;

  /**
   * userMe 세팅
   * userListExceptMe 세팅
   * sameRoomUserList 세팅
   */
  userSetting();

  /**
   * 사용자 목록 새로고침
   */
  var listElem = document.querySelector(".userlistbox");

  // 사용자 목록 전부 삭제
  while (listElem.firstChild) {
    listElem.removeChild(listElem.firstChild);
  }

  // 같은 방에 있는 유저들 추가 (방없는 사람들은 없는 사람들 끼리)
  sameRoomUserList.forEach(function(user) {
    const item = document.createElement("li");
    // 사용자 목록에 사용자 추가
    item.setAttribute('id', 'user_' + user.clientID);
    item.appendChild(document.createTextNode(user.userName));
    listElem.appendChild(item);
  });

  // 비디오 추가
  const cameraBoxContainer = document.getElementById('camerabox');
  sameRoomUserListExceptMe.forEach(function(user) {
    const userClientID = user.clientID;
    const video = document.getElementById('video_' + userClientID);

    // 비디오가 이미 존재하지 않을 경우에만 생성
    if(!video){
      const newVideo = document.createElement("video");
      newVideo.setAttribute("autoplay", "");
      newVideo.setAttribute("id", 'video_' + userClientID);
      newVideo.setAttribute("class", "video");
      
      cameraBoxContainer.appendChild(newVideo);
    }
  });

  // 같은방 유저리스트에는 없는데 컴포넌트만 존재할 경우 삭제
  const videos = document.getElementById('camerabox').children;
  for(let i=videos.length-1; i>0; i--){
    const video = videos[i];
    const exist = sameRoomUserListExceptMe.some(user => 'video_' + user.clientID === video.id); 
    if(!exist){
      video.remove();
    }
  }

  // 같은방 내에서, 로컬이 살아있다면 다시 offer를 보내주자
  if(localStream){
    for(const user of sameRoomUserListExceptMe){
      const anotherClientID = user.clientID;

      /**
       * 피어가 없을 경우 생성 하고, 트랙을 추가한다.
       * 단, 상대방 또한 카메라가 켜져 있다면 둘 중 clientID가 더 낮은 쪽에서 생성하도록 하자
       */
      let anotherPeerConnection = peerConnections[anotherClientID];
      if(!anotherPeerConnection){
        // 상대방이 켜져 있다면, 둘중 clientID가 더 낮은 쪽에서 생성
        if(user.cameraOn){
          if(clientID < anotherClientID){
            // peer 생성
            anotherPeerConnection =  createPeerConnection(anotherClientID);
            // 해당 peer에 트랙 추가
            localStream.getTracks().forEach(
              track => anotherPeerConnection.addTrack(track, localStream)
            ); 
          }
        }else{
          // peer 생성
          anotherPeerConnection =  createPeerConnection(anotherClientID);
          // 해당 peer에 트랙 추가
          localStream.getTracks().forEach(
            track => anotherPeerConnection.addTrack(track, localStream)
          ); 
        }
      }
    }
  }
}

function userSetting(){
  // 나
  userMe = userList.filter(user => user.clientID === clientID)[0];
  const myRoom = userMe.room;

  // 현재 나를 제외한 모든 사용자 리스트
  userListExceptMe = userList.filter(function(user, idx, ar) {
    return user.clientID !== clientID
  });

  // 나와 같은방 유저 리스트
  sameRoomUserList = userList.filter(user => {
    if(myRoom === user.room) return true;
    return false;
  });

  sameRoomUserListExceptMe = userListExceptMe.filter(user => {
    if(myRoom === user.room) return true;
    return false;
  });
}

function removeRenderVideoFrame(mClientID){
  const cameraBoxContainer = document.getElementById('camerabox');
  const video = document.getElementById('video_' + mClientID);
  if(video){
    cameraBoxContainer.removeChild(video);
  }
}

function renderVideoFrame(){
  const cameraBoxContainer = document.getElementById('camerabox');

  for(const clientID of sameRoomUserList){
    const video = document.getElementById('video_' + clientID);
    if(!video){
      const newVideo = document.createElement("video");
      newVideo.setAttribute("autoplay", "");
      newVideo.setAttribute("id", 'video_' + clientID);
      newVideo.setAttribute("class", "video");
      
      cameraBoxContainer.appendChild(newVideo);
    }
  }
}

function closeLocalVedio(){
  log("Closing Local Vedio");
  const localVideo = document.getElementById('local_video');
  /**
   * 로컬 비디오를 멈춥니다.
   * tracks들을 각각 멈춥니다.
   */
  if (localVideo.srcObject) {
    localVideo.pause();
    localVideo.srcObject.getTracks().forEach(track => {
      track.stop();
    });

    localVideo.srcObject = null;
    localStream = null;
  }
}

// RTCPeerConnection을 닫고, 변수를 초기화 합니다.
function closeRemoteVedio(mClientID) {
  log("video close");

  const remoteVideo = document.getElementById('video_' + mClientID);
  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }
}

function peerClose(mClientID){
  let peerConnection = peerConnections[mClientID];

  if (peerConnection) {
    log("--> Closing the peer connection");

    // 모든 이벤트 리스너를 해제시킵니다.
    peerConnection.ontrack = null;
    peerConnection.onnicecandidate = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onsignalingstatechange = null;
    peerConnection.onicegatheringstatechange = null;
    peerConnection.onnotificationneeded = null;

    // PeerConnection에 대한 transceivers를 모두 멈춥니다.
    peerConnection.getTransceivers().forEach(transceiver => {
      transceiver.stop();
    });

    // PeerConnection 닫기
    peerConnection.close();
    peerConnection = null;

    delete peerConnections[mClientID];
  }
}

function socketClose(msg){
  const senderID = msg.sender;

  if(!senderID) return;

  // peer close
  peerClose(senderID);

  // 나간 사용자 삭제
  document.getElementById('user_' + senderID).remove();

  // Video Frame 없애기
  removeRenderVideoFrame(senderID);
}

/**
 * Remote Video Close
 * - 해당 PeerConnection 중지 및 삭제
 * - 비디오 Frame 없애기 
 */
function handleHangUp(msg) {
  log("*** Received hang up notification from other peer");

  const senderID = msg.sender;
  closeRemoteVedio(senderID);
}

/**
 * 현재 offer를 받으면 Remote Description에 세팅하고,
 * answer를 생성하고 Local Desscription에 세팅후 다시 보낸다.
 * TODO: 그런데, 여기서 받은 client도 camera를 open하고 서버로 미디어 데이터를 추가하는데
 * 필요없어보인다. 
 */
async function handleVideoOffer(msg) {
  
  const senderID = msg.sender;
  const user = userMe;
  const userName = user.userName;

  let peerConnection = peerConnections[senderID];

  // 상대방 peer와 연결될 peer가 없을 경우에만 생성한다.
  if(!peerConnection){
    peerConnection = createPeerConnection(senderID);
    if(localStream){
      // 해당 peer에 트랙 추가
      localStream.getTracks().forEach(
        track => peerConnection.addTrack(track, localStream)
      ); 
    }
  }

  /**
   * 받은 sdp를 Offer로 변환
   */
  var desc = new RTCSessionDescription(msg.sdp);

  if (peerConnection.signalingState != "stable") {
    log("  - But the signaling state isn't stable, so triggering rollback");

    /**
     * PeerConnection의 시그널상태가 stable될 때까지, local Description을 삭제하고 롤백합니다.
     */
    await Promise.all([
      peerConnection.setLocalDescription({type: "rollback"}),
      peerConnection.setRemoteDescription(desc)
    ]);
    return;
  } else {
    log ("  - Setting remote description");

    // Remote Description에 Offer 세팅
    await peerConnection.setRemoteDescription(desc);
  }

  log("---> Creating and sending answer to caller");

  await peerConnection.setLocalDescription(await peerConnection.createAnswer());

  // target을 없애서 모든 user에게 보내주자.
  sendToServer({
    name: userName,
    target: senderID,
    sender: clientID,
    type: "video-answer",
    sdp: peerConnection.localDescription
  });
}

async function handleVideoAnswerMsg(msg) {
  log("*** Call recipient has accepted our call");

  const senderID = msg.sender;

  const peerConnection = peerConnections[senderID];

  // 받은 sdp를 answer로 변환
  var desc = new RTCSessionDescription(msg.sdp);

  // Remote Description을 answer로 세팅
  await peerConnection.setRemoteDescription(desc).catch(reportError);
}

async function handleNewICECandidateMsg(msg) {
  // 받은 candidate로 부터 RTCIceCandidate 생성
  var candidate = new RTCIceCandidate(msg.candidate);

  const senderID = msg.sender;
  const peerConnection = peerConnections[senderID];

  log("*** Adding received ICE candidate: " + JSON.stringify(candidate));
  try {
    // PeerConnection에 candidate 추가
    await peerConnection.addIceCandidate(candidate)
  } catch(err) {
    reportError(err);
  }
}


function handleGetUserMediaError(e) {
  log_error(e);
  switch(e.name) {
    case "NotFoundError":
      alert("Unable to open your call because no camera and/or microphone" +
            "were found.");
      break;
    case "SecurityError":
    case "PermissionDeniedError":
      // Do nothing; this is the same as the user canceling the call.
      break;
    default:
      alert("Error opening your camera and/or microphone: " + e.message);
      break;
  }

  // Make sure we shut down our end of the RTCPeerConnection so we're
  // ready to try again.
  closeLocalVedio();
}

// 에러로그
function reportError(errMessage) {
  log_error(`Error ${errMessage.name}: ${errMessage.message}`);
}

// 카메라 ON
async function cameraOn(){
    const myRoom = userMe.room;

    if(localStream){
      alert("이미 캠이 켜져있습니다.");
    }else{

      try {
        // 로컬 스트림 ON
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        document.getElementById('local_video').srcObject = localStream;

        // 카메라 온
        sendToServer({
          type: "camera-on"
        });

        // remote에 대한 peer를 모두 생성
        for(const user of userListExceptMe){
          const userRoom = user.room;

          // 같은방 사람들에게만 offer 보낸다.
          if(userRoom !== myRoom){
            return;
          }

          // 이미 존재하는 peer는 패스
          let peerConnection = peerConnections[user.clientID];
          if(peerConnection) {
            // 해당 peer에 트랙 추가
            localStream.getTracks().forEach(
              track => peerConnection.addTrack(track, localStream)
            );
            continue;
          };

          // peer 생성
          peerConnection =  createPeerConnection(user.clientID);

          // 해당 peer에 트랙 추가
          localStream.getTracks().forEach(
            track => peerConnection.addTrack(track, localStream)
          );  
        }

      } catch(err) {
        handleGetUserMediaError(err);
        return;
      }
    }
}

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
    	console.log('콘텐츠 표시 상태');
        return;
    }
    
    if (document.visibilityState === 'hidden') {
    	console.log('콘텐츠 비활성화(백그라운드화) 상태');
    }
});

// 케메라를 끈다.
async function cameraOff(){
  closeLocalVedio();

  sendToServer({
    sender: clientID,
    type: "camera-off"
  });
}

const intervalID = setInterval(() => {
  if(Game.hero){
    sendToServer({
      type: "position",
      hero: Game.hero
    });
  }
}, 100);

function goRoom(inRoom){
  document.getElementById('room').innerHTML = inRoom;
  // 존재하는 PeerConnection들 모두 close하고, 상대방에게도 알려준다.
  for(const peerClientID in peerConnections){
    peerClose(peerClientID);

    sendToServer({
      sender: clientID,
      target: peerClientID,
      type: "peer-close"
    });
  }

  // hero 업데이트
  // if(inRoom){
  //   this.hero.room = inRoom;
  // }else{
  //   delete this.hero.room;
  // }

  // room 업데이트하고, 유저들에게 알린다.
  sendToServer({
    sender: clientID,
    room: inRoom,
    type: "room-in"
  });
}

window.onload = async function(){
    // 1. 사용자명 임의로 정해주자.
    document.getElementById("name").value = "song1"; 
}
