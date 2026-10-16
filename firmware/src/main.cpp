// Demo firmware: GPIO relay/LED + simulated electrical measurements.
// Replace readPower() with a calibrated meter driver before measuring real loads.
#include <Arduino.h>
#include <WiFi.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include "config.h"

AsyncMqttClient mqtt;
bool relayState=false;
unsigned long lastSend=0,lastConnect=0;
unsigned int periodSeconds=5;
String lastCommand,lastAck;
String incoming;
String isoNow(){struct timeval tv;gettimeofday(&tv,nullptr);struct tm utc;gmtime_r(&tv.tv_sec,&utc);char b[40];strftime(b,sizeof(b),"%Y-%m-%dT%H:%M:%S",&utc);char ms[10];snprintf(ms,sizeof(ms),".%03ldZ",tv.tv_usec/1000);return String(b)+ms;}
time_t parseUtc(const char* text){struct tm value={};int year,month,day,hour,minute,second;if(sscanf(text,"%d-%d-%dT%d:%d:%d",&year,&month,&day,&hour,&minute,&second)!=6)return 0;value.tm_year=year-1900;value.tm_mon=month-1;value.tm_mday=day;value.tm_hour=hour;value.tm_min=minute;value.tm_sec=second;return mktime(&value);}
void ack(const String& id,const char* error=nullptr){StaticJsonDocument<512> doc;doc["ma_thiet_bi"]=DEVICE_ID;doc["ma_lenh"]=id;doc["trang_thai_relay"]=relayState;doc["thoi_gian"]=isoNow();if(error)doc["loi"]=error;String data;serializeJson(doc,data);lastCommand=id;lastAck=data;mqtt.publish((String(TOPIC_BASE)+"/ack").c_str(),1,false,data.c_str());}
void onMessage(char* topic,char* payload,AsyncMqttClientMessageProperties props,size_t len,size_t index,size_t total){
 if(total>2048)return;if(index==0)incoming="";for(size_t i=0;i<len;i++)incoming+=payload[i];if(index+len<total)return;
 StaticJsonDocument<1024> doc;if(deserializeJson(doc,incoming))return;
 if(String(topic)==String(TOPIC_BASE)+"/config"){int p=doc["chu_ky_gui"]|5;if(p>=1&&p<=60)periodSeconds=p;return;}
 if(props.retain||String(topic)!=String(TOPIC_BASE)+"/command")return;
 if(String(doc["ma_thiet_bi"]|"")!=DEVICE_ID)return;
 String id=doc["ma_lenh"]|"";if(id.length()!=36)return;
 if(id==lastCommand){mqtt.publish((String(TOPIC_BASE)+"/ack").c_str(),1,false,lastAck.c_str());return;}
 if(time(nullptr)<1700000000)return; // Require NTP before accepting time-sensitive commands.
 if(parseUtc(doc["het_han"]|"")<time(nullptr)){ack(id,"Lệnh đã hết hạn");return;}
 String action=doc["hanh_dong"]|"";if(action!="Bật"&&action!="Tắt"){ack(id,"Hành động không hợp lệ");return;}
 relayState=action=="Bật";digitalWrite(RELAY_PIN,relayState?HIGH:LOW);ack(id);
}
void setup(){
 Serial.begin(115200);pinMode(RELAY_PIN,OUTPUT);digitalWrite(RELAY_PIN,LOW);
 setenv("TZ","UTC0",1);tzset();WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);configTime(0,0,"pool.ntp.org","time.nist.gov");
 mqtt.setServer(MQTT_HOST,1883);mqtt.setCredentials(MQTT_USER,MQTT_PASS);mqtt.setClientId("energy-esp32-demo-1");mqtt.setCleanSession(false);
 mqtt.onConnect([](bool sessionPresent){mqtt.subscribe((String(TOPIC_BASE)+"/command").c_str(),1);mqtt.subscribe((String(TOPIC_BASE)+"/config").c_str(),1);Serial.println("MQTT connected");});mqtt.onMessage(onMessage);
}
void loop(){
 if(!mqtt.connected()&&WiFi.status()==WL_CONNECTED&&millis()-lastConnect>3000){lastConnect=millis();mqtt.connect();}
 if(WiFi.status()!=WL_CONNECTED&&millis()-lastConnect>10000){lastConnect=millis();WiFi.reconnect();}
 if(mqtt.connected()&&time(nullptr)>1700000000&&millis()-lastSend>=periodSeconds*1000){
  lastSend=millis();float power=relayState?600+random(0,100):0;
  StaticJsonDocument<512> doc;doc["ma_thiet_bi"]=DEVICE_ID;doc["thoi_gian_do"]=isoNow();doc["cong_suat_w"]=power;doc["dien_ap_v"]=220;doc["dong_dien_a"]=power/220;doc["nhiet_do_c"]=30;doc["trang_thai_relay"]=relayState;
  String data;serializeJson(doc,data);mqtt.publish((String(TOPIC_BASE)+"/telemetry").c_str(),1,false,data.c_str());
 }
 delay(5);
}
