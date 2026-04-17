// js/webrtc.js
// Pure WebRTC peer connection manager
// Signaling is done via Appwrite Realtime on the session document

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN server for production:
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'turnuser',
    //   credential: 'turnpassword'
    // }
  ]
};

class WebRTCManager {
  constructor({ sessionId, isInitiator, onRemoteStream, onConnectionState }) {
    this.sessionId = sessionId;
    this.isInitiator = isInitiator;
    this.onRemoteStream = onRemoteStream;
    this.onConnectionState = onConnectionState;
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];
    this._unsubscribe = null;
  }

  async start(includeVideo = false) {
    // Get local media
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: includeVideo
    });

    // Create peer connection
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    // Add tracks
    this.localStream.getTracks().forEach(track => {
      this.pc.addTrack(track, this.localStream);
    });

    // Handle remote stream
    this.pc.ontrack = (e) => {
      if (this.onRemoteStream) this.onRemoteStream(e.streams[0]);
    };

    // Handle ICE candidates — store in Appwrite session document
    this.pc.onicecandidate = async (e) => {
      if (e.candidate) {
        await this._sendSignal({ type: 'ice', candidate: e.candidate.toJSON() });
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      if (this.onConnectionState) this.onConnectionState(this.pc.connectionState);
    };

    // Subscribe to incoming signals via Appwrite Realtime
    this._subscribeToSignals();

    if (this.isInitiator) {
      await this._createOffer();
    }

    return this.localStream;
  }

  async _createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._sendSignal({ type: 'offer', sdp: offer });
  }

  async _handleSignal(signal) {
    try {
      if (signal.type === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this._sendSignal({ type: 'answer', sdp: answer });
        // Flush pending candidates
        for (const c of this.pendingCandidates) {
          await this.pc.addIceCandidate(new RTCIceCandidate(c));
        }
        this.pendingCandidates = [];
      } else if (signal.type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'ice') {
        if (this.pc.remoteDescription) {
          await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          this.pendingCandidates.push(signal.candidate);
        }
      }
    } catch (err) {
      console.error('Signal handling error:', err);
    }
  }

  async _sendSignal(signal) {
    // Store signal in session document — partner reads it via Realtime
    const db = getDatabases();
    const existing = await db.getDocument(
      APPWRITE_CONFIG.databaseId,
      APPWRITE_CONFIG.collections.sessions,
      this.sessionId
    );

    const signalKey = this.isInitiator ? 'signalFromInitiator' : 'signalFromReceiver';
    const signals = JSON.parse(existing[signalKey] || '[]');
    signals.push({ ...signal, ts: Date.now() });

    await db.updateDocument(
      APPWRITE_CONFIG.databaseId,
      APPWRITE_CONFIG.collections.sessions,
      this.sessionId,
      { [signalKey]: JSON.stringify(signals) }
    );
  }

  _subscribeToSignals() {
    const signalKey = this.isInitiator ? 'signalFromReceiver' : 'signalFromInitiator';
    let lastProcessedTs = 0;

    this._unsubscribe = subscribeToSession(this.sessionId, async (session) => {
      const raw = session[signalKey];
      if (!raw) return;
      try {
        const signals = JSON.parse(raw);
        for (const sig of signals) {
          if (sig.ts > lastProcessedTs) {
            lastProcessedTs = sig.ts;
            await this._handleSignal(sig);
          }
        }
      } catch {}
    });
  }

  async enableVideo() {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const videoTrack = videoStream.getVideoTracks()[0];

    // Replace or add video track
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(videoTrack);
    } else {
      this.pc.addTrack(videoTrack, this.localStream);
    }
    this.localStream.addTrack(videoTrack);
    return videoTrack;
  }

  toggleMute(muted) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }

  getLocalStream() { return this.localStream; }

  destroy() {
    if (this._unsubscribe) this._unsubscribe();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
  }
}
