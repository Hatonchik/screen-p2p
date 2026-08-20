// app.js
// WebRTC P2P трансляція екрана. Сервер лише передає SDP/ICE (сигналінг),
// самі відеокадри йдуть напряму між браузерами (peer-to-peer).

const statusEl = document.getElementById('status');
const joinBtn = document.getElementById('joinBtn');
const shareBtn = document.getElementById('shareBtn');
const stopBtn = document.getElementById('stopBtn');
const roomIdInput = document.getElementById('roomId');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let ws = null;
let pc = null;
let localStream = null;
let roomId = null;
let isInitiator = false; // хто першим почав share, той створює offer

// STUN-сервер потрібен для встановлення P2P з'єднання через NAT.
// Якщо обидва учасники за "жорстким" NAT/корпоративним фаєрволом,
// самого STUN може бути недостатньо — тоді знадобиться TURN-сервер
// (наприклад, coturn), інакше з'єднання не встановиться.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

function setStatus(text) {
  statusEl.textContent = text;
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      wsSend({ type: 'ice-candidate', candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    setStatus('Стан з\'єднання: ' + pc.connectionState);
  };
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

joinBtn.onclick = () => {
  roomId = roomIdInput.value.trim() || 'default';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    wsSend({ type: 'join', roomId });
    setStatus('Підключено до сигнального сервера, кімната: ' + roomId);
    joinBtn.disabled = true;
    shareBtn.disabled = false;
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'joined') {
      isInitiator = msg.peers === 0;
      createPeerConnection();
    }

    if (msg.type === 'room-full') {
      setStatus('Кімната вже заповнена (максимум 2 учасники).');
      return;
    }

    if (msg.type === 'peer-joined') {
      setStatus('Другий учасник приєднався. Можна починати трансляцію.');
    }

    if (msg.type === 'peer-left') {
      setStatus('Співрозмовник відключився.');
      remoteVideo.srcObject = null;
    }

    if (msg.type === 'offer') {
      if (!pc) createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: 'answer', sdp: answer });
    }

    if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }

    if (msg.type === 'ice-candidate') {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (e) {
        console.error('Помилка додавання ICE candidate:', e);
      }
    }
  };

  ws.onclose = () => setStatus('З\'єднання із сервером закрито.');
};

shareBtn.onclick = async () => {
  try {
    // Ключове місце для якості 1080p/60fps: constraints для захоплення екрана.
    // Реальний результат залежить від можливостей ОС/браузера та обраного
    // джерела (весь екран / вікно / вкладка) — деякі джерела не дають 60fps.
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 60, max: 60 }
      },
      audio: false // постав true, якщо треба захоплювати системний звук (підтримка залежить від браузера/ОС)
    });

    localVideo.srcObject = localStream;

    if (!pc) createPeerConnection();

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Задаємо бітрейт вручну — за замовчуванням браузер часто занижує його,
    // що при 1080p60 виглядає розмито. ~6-8 Мбіт/с — орієнтир для VP8/VP9.
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 8_000_000;
      await sender.setParameters(params);
    }

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend({ type: 'offer', sdp: offer });
    }

    // Якщо користувач зупинить показ екрана через системний UI браузера
    localStream.getVideoTracks()[0].onended = () => stopSharing();

    shareBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus('Трансляція екрана запущена.');
  } catch (err) {
    console.error(err);
    setStatus('Не вдалося отримати доступ до екрана: ' + err.message);
  }
};

stopBtn.onclick = () => stopSharing();

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  shareBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('Трансляцію зупинено.');
}
