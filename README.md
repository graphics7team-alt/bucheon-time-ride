# 부천 타임라이드

카메라가 레일을 따라 스스로 이동하는 부천시립박물관 타임라이드 뼈대입니다.

## 실행 방법

```bash
npm install
npm run dev
```

터미널에 나온 주소(보통 http://localhost:5173 )를 브라우저에서 엽니다.

## 파일 넣는 곳

- 음성 mp3는 `public/audio/`에 넣습니다.  
  예: `public/audio/voice1.mp3` (`src/stops.json`의 `audio` 경로와 같은 이름)
- 3D 모델 glb는 `public/models/`에 넣습니다.  
  예: `public/models/door.glb` (소품의 `modelPath`와 같은 이름)

파일이 없으면 오류 없이, 음성은 `durationSec` 길이로, 모델은 단순 도형으로 진행합니다.

## 시선 이동

라이드가 시작된 뒤, 마우스나 한 손가락으로 화면을 드래그하거나 방향키로 고개를 돌릴 수 있습니다. Home 키를 누르면 정면으로 돌아옵니다.

`?debug=1`을 붙이면 왼쪽 위에 구간 정보와 yaw/pitch가 나오고, 숫자 키 0~7로 구간 이동, 스페이스바로 일시정지가 됩니다. `?kiosk=1`이면 자막이 1.25배가 되고, 가만히 있으면 20초 뒤 시선이 정면으로 돌아옵니다.
