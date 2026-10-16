import {randomBytes} from 'node:crypto';import {writeFile,access} from 'node:fs/promises';
try{await access('.env');console.log('.env đã tồn tại, giữ nguyên thông tin cấu hình.');process.exit(0);}catch{}
const secret=()=>randomBytes(24).toString('hex');const mongo=secret(),mqtt=secret(),sim=secret(),admin='Admin_'+randomBytes(9).toString('base64url'),demo='Demo_'+randomBytes(9).toString('base64url');
const content=`PORT=3000
NODE_ENV=development
MONGO_DB=smart_energy
MONGO_ROOT_PASSWORD=${mongo}
MONGO_URI=mongodb://root:${mongo}@localhost:27018/smart_energy?authSource=admin
JWT_SECRET=${secret()}${secret()}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin}
DEMO_PASSWORD=${demo}
SEED_DEMO=true
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=energy_api
MQTT_PASSWORD=${mqtt}
SIM_MQTT_PASSWORD=${sim}
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SIM_MODE=normal
SIM_ACK_MODE=normal
`;
await writeFile('.env',content,{mode:0o600,flag:'wx'});console.log('Đã tạo .env với mật khẩu ngẫu nhiên.');console.log('Tài khoản admin / '+admin);console.log('Tài khoản manager hoặc viewer / '+demo);console.log('Tiếp theo: docker compose up --build -d');
