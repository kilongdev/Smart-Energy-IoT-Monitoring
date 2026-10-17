import {test} from 'node:test';import assert from 'node:assert/strict';import {energyBetween,inWindow,isOnline,localClock,compare} from '../src/domain';
test('Khung giờ qua nửa đêm dùng giờ Việt Nam và loại điểm kết thúc',()=>{
 assert.equal(inWindow(new Date('2026-10-15T16:00:00Z'),'22:00-06:00'),true);
 assert.equal(inWindow(new Date('2026-10-14T23:00:00Z'),'22:00-06:00'),false);
 assert.equal(inWindow(new Date('2026-10-15T04:00:00Z'),'22:00-06:00'),false);
 assert.equal(localClock(new Date('2026-10-15T10:00:00Z')).time,'17:00:00');
});
test('Điện năng tính theo timestamp, cắt ở biên giờ, không nối khoảng mất dữ liệu',()=>{
 const rows=[{thoi_gian_do:new Date(0),cong_suat_w:1000},{thoi_gian_do:new Date(10000),cong_suat_w:1000},{thoi_gian_do:new Date(60000),cong_suat_w:1000}];
 assert.equal(energyBetween(rows,5000,60000,15000).coveredMs,5000);
 assert.ok(Math.abs(energyBetween(rows,0,10000,15000).kwh-10000/3600000)<1e-10);
});
test('Online có giới hạn ba chu kỳ, số đo 0 vẫn hợp lệ',()=>{
 assert.equal(isOnline({lastSeen:new Date(0),chu_ky_gui:5},15000),true);assert.equal(isOnline({lastSeen:new Date(0),chu_ky_gui:5},15001),false);
 assert.equal(compare(0,'<=',0),true);assert.equal(compare(10,'>',20),false);
});
