// 서버 실행 및 라우팅 작업 수행
require("dotenv").config(); // 환경 변수 로드
const {callUser} = require("./callUser");
const {createRecognizeStream} = require('./stt');
const {sendTTSResponse} = require("./tts");
const {getGPTResponse} = require("./gpt");
const https = require('https');
const fs = require('fs');
const express = require("express");
const WebSocket = require('ws');
const twilio = require("twilio");

const app = express();
const VoiceResponse = twilio.twiml.VoiceResponse;

app.use(express.json()); // JSON 자동 파싱
app.use(express.urlencoded({extended: true})); // URL 자동 파싱

// SSL 인증서와 개인 키 읽기
const options = {
  cert: fs.readFileSync('/etc/letsencrypt/live/welfarebot.kr/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/welfarebot.kr/privkey.pem'),
};

// HTTPS 서버 및 WebSocket 설정
const httpsServer = https.createServer(options, app);
const wss = new WebSocket.Server({server: httpsServer});

let isFirstCalling = true; // 중복 전화 방지 플래그

// HTTPS 포트 443에서 서버 리스닝
httpsServer.listen(443, () => {
  console.log("HTTPS 서버가 포트 443에서 실행 중입니다.");
});

// HTTP 포트 80을 열어 HTTPS로 리디렉션하는 옵션
const http = require('http');
http.createServer(app).listen(80, () => {
  console.log("HTTP 서버가 포트 80에서 실행 중입니다. HTTPS로 리디렉션합니다.");
});

// 사용자에게 전화를 걸음
app.get("/call", async (req, res) => {
  if (!isFirstCalling) {
    return res.status(429).send("이미 전화가 진행 중입니다.");
  }

  isFirstCalling = false;

  try {
    await callUser();
    res.status(200).send("전화가 성공적으로 걸림");
  } catch (error) {
    console.error("전화 거는 과정에서 오류 발생: ", error);
  }
});

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();
  const gptRequest = req.query.gptRequest;

  try {
    // 사용자 인증 메시지 출력
    // twiml.say({language: "ko-KR"}, message);
    // console.log("사용자 인증 메시지: ", message);

    // 상담 시작 메시지 출력
    const gptResponse = await getGPTResponse(gptRequest);

    twiml.say({language: "ko-KR"}, gptResponse);
    console.log("상담 시작 메시지: ", gptResponse);

    //양방향 스트림 연결 설정
    const connect = twiml.connect();
    connect.stream({
      url: 'wss://welfarebot.kr',
      name: 'conversation_stream'
    });
  } catch (error) {
    console.error("GPT 응답 처리 중 오류 발생: ", error);
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// WebSocket 연결
wss.on('connection', (ws) => {
  console.log("\nWebSocket 연결 성공");
  let recognizeStream = null;
  let timeoutHandle = null;
  let haslogged = false;

  ws.on('message', message => {
    const msg = JSON.parse(message);

    switch (msg.event) {
      case "connected":
        console.log("\n미디어 스트림 연결됨");
        //console.log(msg);
        break;

      case "start":
        console.log("\n미디어 스트림 시작\n");
        // console.log(msg);        
        break;

      case "media":
        // console.log("\n오디오 데이터 전달");
        // console.log(msg);

        if(!recognizeStream) {
          //실시간 음성 처리
          console.log("새 STT 스트림 생성");
          haslogged = false;

          recognizeStream = createRecognizeStream()
            .on('error', console.error)
            .on('data', data => {
              console.log("\n시간: ", msg.media.timestamp);
              console.log(data.results[0]);
              const transcription = data.results[0].alternatives[0].transcript;
              console.log("STT 전사 결과: ", transcription);
              
              // 0.3초 이내에 다음 전사된 텍스트를 받으면 타이머 초기화
              if(timeoutHandle) {
                clearTimeout(timeoutHandle);
                console.log("타이머 초기화");
              }
              
              // 0.3초 동안 구글 STT로 부터 받은 데이터가 없으면 문장이 끝났다고 판단
              timeoutHandle = setTimeout(async () => {
              recognizeStream.destroy();
              console.log("STT 스트림 종료");

              // STT 결과를 GPT에 전달
              const gptResponse = await getGPTResponse(transcription);
              console.log("\nGPT 결과: ", gptResponse, "\n");
            
              // GPT 응답을 TTS로 변환
              await sendTTSResponse(ws, msg.streamSid, gptResponse);
              recognizeStream = null;
              console.log("STT 스트림 초기화");
            }, 700);
          });
        }

        // 스트림이 존재하고 destroy 되지 않았을 때 스트림에 데이터 쓰기
        if(!recognizeStream.destroyed && recognizeStream) {
          //console.log(msg.media.timestamp);
          recognizeStream.write(msg.media.payload);
        } else if (!haslogged){
          console.log("\nrecognizeStream이 종료되어 데이터를 쓸 수 없습니다.")
          haslogged = true;
        }
        break;
      case "stop":
        console.log("\n전화 종료");
        // console.log(msg);
        if(recognizeStream) {
          recognizeStream.destroy();
        }
        break;
    }
  });

  // 연결 종료 처리
  ws.on('close', () => {
      console.log("클라이언트와 연결이 종료되었습니다.");
      isFirstCalling = true;
  });
});
