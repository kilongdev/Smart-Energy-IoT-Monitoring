import {randomBytes} from 'node:crypto';import {writeFile,access} from 'node:fs/promises';
try{await access('.env');console.log('.env đã tồn tại, giữ nguyên thông tin cấu hình.');process.exit(0);}catch{}
const secret=()=>randomBytes(24).toString('hex');const admin='Admin_'+randomBytes(9).toString('base64url'),demo='Demo_'+randomBytes(9).toString('base64url');
const content=`PORT=3000
NODE_ENV=development
MONGO_DB=smart_energy
MONGO_URI=
JWT_SECRET=${secret()}${secret()}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${admin}
DEMO_PASSWORD=${demo}
SEED_DEMO=false
MQTT_URL=
MQTT_USERNAME=
MQTT_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DASHBOARD_URL=
SIM_MODE=normal
SIM_ACK_MODE=normal
`;
await writeFile('.env',content,{mode:0o600,flag:'wx'});console.log('Đã tạo .env với mật khẩu ngẫu nhiên.');console.log('Tài khoản admin / '+admin);console.log('Tài khoản manager hoặc viewer / '+demo);console.log('Điền MONGO_URI Atlas và MQTT_URL/USERNAME/PASSWORD EMQX vào .env, rồi docker compose up --build -d api');
