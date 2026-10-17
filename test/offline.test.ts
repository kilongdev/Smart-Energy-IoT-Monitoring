// Same HTTP/MQTT behavior scenarios, explicitly using a DB test double.
process.env.TEST_STORE='memory';
require('./integration.cases');
