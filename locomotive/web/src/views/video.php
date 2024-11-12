<div id="video-grid" 
    class="d-flex2 h-full overflow-hidden flex2-wrap flex-row justify-content-center align-items-center">
</div>

<script src="https://webrtc.github.io/adapter/adapter-latest.js"></script>
<script type="module">
import {Video} from "<?= js('video.js'); ?>";

let $firstVideo;
let localVideo;
let localStream;
let peerConnection;
let pc1;
let pc2;
let stream;

var iceServers = [ 
    { url: 'stun:freestun.net:3478' }, 
    { url: 'turn:freestun.net:3478', username: 'free', credential: 'free' } 
];

const offerOptions = {
    offerToReceiveAudio: 1,
    offerToReceiveVideo: 1
};

// Configuration for the peer connection
const peerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' }
    ]
};


// Function to initialize the media stream
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        console.log('Received local stream', localStream);
        localVideo.srcObject = localStream;
        localVideo.play();
    } catch (error) {
        console.error('Error accessing media devices.', error);
    }
}

function initPeerConnection() {
    peerConnection = new RTCPeerConnection(peerConnectionConfig);

    // Add local stream tracks to the peer connection
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Set up event handlers for the peer connection
    peerConnection.onicecandidate = handleICECandidateEvent;
    peerConnection.ontrack = handleTrackEvent;
}

function handleICECandidateEvent(event) {
    if (event.candidate) {
        console.log('New ICE candidate:', event.candidate);
    }
}

function handleTrackEvent(event) {
    remoteVideo.srcObject = event.streams[0];
}

$(function() {
    const v = new Video();

    v.on("videos_added", () => {
        console.log('----------------------');
        $firstVideo = $("#video_0");
        localVideo =$firstVideo.get(0);

        $firstVideo.on("click", function(e) {
            e.preventDefault();
            initLocalStream().then(initPeerConnection);
        });



    });

});
</script>
