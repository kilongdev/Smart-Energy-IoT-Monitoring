import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { io } from 'socket.io-client';
type Row = Record<string, any>;
const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(n || 0);
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'Chưa có';
const getToken = () => sessionStorage.getItem('energy-token');
async function api(path: string, method = 'GET', data?: any, signal?: AbortSignal) {
  const r = await fetch('/api/v1/' + path, {
    method,
    signal,
    headers: {
      Authorization: 'Bearer ' + getToken(),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('energy-logout'));
    throw new Error(
      Array.isArray(value.message)
        ? value.message.join('; ')
        : value.message || 'Yêu cầu thất bại',
    );
  }
  return value;
}
function Icon({ name }: { name: string }) {
  const p: Record<string, string> = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
    alert: 'm12 3 10 18H2z M12 9v5 M12 17v1',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    control: 'M12 2v10 M6 5a9 9 0 1 0 12 0',
    schedule: 'M8 2v4 M16 2v4 M3 10h18 M3 4h18v17H3z M8 14h3 M8 17h6',
    catalog: 'M3 7h18v14H3z M3 7l3-4h12l3 4 M8 12h8',
    logs: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
    energy: 'm13 2-9 12h7l-1 8 10-13h-7z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={p[name] || p.energy} />
    </svg>
  );
}
function Badge({ value }: { value: any }) {
  const labels: Record<string, string> = {
    LOW: 'Thấp',
    MEDIUM: 'Trung bình',
    HIGH: 'Cao',
  };
  let cls = ['Thành công', 'Đã phục hồi', 'LOW', true].includes(value)
    ? 'good'
    : [
          'Thất bại',
          'Thất bại vĩnh viễn',
          'Gửi thất bại',
          'Tạm dừng',
          'HIGH',
          'Cao',
          'Mới',
          false,
        ].includes(value)
      ? 'bad'
      : 'neutral';
  if (value === 'Đang phục hồi' || value === 'MEDIUM' || value === 'Trung bình') {
    cls = 'warning';
  }
  if (value === 'Đang diễn ra') {
    cls = 'bad';
  } else if (value === 'Đã kết thúc' || value === 'Thông số đã phục hồi') {
    cls = 'good';
  }
  return (
    <span className={'badge ' + cls}>
      {value === true
        ? 'Đang kết nối'
        : value === false
          ? 'Mất kết nối'
          : value === 'NO_DATA'
            ? 'Chưa có dữ liệu'
            : labels[value] || value}
    </span>
  );
}
const alertMetricLabels: Record<string, string> = {
  cong_suat_w: 'Công suất',
  dien_ap_v: 'Điện áp',
  dong_dien_a: 'Dòng điện',
  dong_ro_ma: 'Dòng rò',
  nhiet_do_c: 'Nhiệt độ',
};
const alertSeverityLabels: Record<string, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
};
const alertDeliveryLabels: Record<string, string> = {
  'Đang chờ': 'Đang chờ gửi',
  'Đã gửi': 'Đã gửi',
  'Thất bại': 'Gửi thất bại',
};
const alertIncidentLabels: Record<string, string> = {
  'Đang diễn ra': 'Đang diễn ra',
  'Đang phục hồi': 'Đang phục hồi',
  'Đã kết thúc': 'Thông số đã phục hồi',
  'Đã gộp': 'Đã gộp cảnh báo trùng',
};
function alertMetricLabel(metric: string) {
  return alertMetricLabels[metric] || metric;
}
function alertSeverityLabel(severity: string) {
  return alertSeverityLabels[severity] || severity;
}
function alertRuleName(rule: Row) {
  if (
    rule.chi_so_can_do === 'cong_suat_w' &&
    rule.toan_tu === '>' &&
    rule.gia_tri_nguong === 4800
  )
    return 'Quá tải';
  if (
    rule.chi_so_can_do === 'dien_ap_v' &&
    rule.toan_tu === '<' &&
    rule.gia_tri_nguong === 198
  )
    return 'Sụt áp';
  if (
    rule.chi_so_can_do === 'dien_ap_v' &&
    rule.toan_tu === '>' &&
    rule.gia_tri_nguong === 242
  )
    return 'Tăng áp';
  if (
    rule.chi_so_can_do === 'dong_ro_ma' &&
    rule.toan_tu === '>=' &&
    rule.gia_tri_nguong === 30
  )
    return 'Rò điện';
  return rule.ten_quy_tac;
}
function alertMessage(alert: Row, devices: Row[], rooms: Row[]) {
  const rule = alert.snapshot?.rule;
  const sample = alert.snapshot?.sample;
  const gateway = devices.find((device) => device._id === alert.ma_thiet_bi);
  const room = gateway?.ma_phong || alert.ma_phong;
  const roomName = rooms.find((item) => item._id === room)?.ten_phong;
  const roomLabel = roomName
    ? roomName
    : room
      ? `Phòng ${room}`
      : 'Chưa xác định phòng';
  if (!rule || sample?.[rule.chi_so_can_do] === undefined) {
    return `${roomLabel}: ${alert.noi_dung_loi}`;
  }
  return `${roomLabel} · ${alertRuleName(rule)}: ${alertMetricLabel(
    rule.chi_so_can_do,
  )} ${rule.toan_tu} ${rule.gia_tri_nguong} (đo được ${
    sample[rule.chi_so_can_do]
  })`;
}
function Chart({ option, height = 290 }: { option: any; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = echarts.init(el.current!);
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={el} style={{ height }} />;
}
const alertMetricUnits: Record<string, string> = {
  cong_suat_w: 'W',
  dien_ap_v: 'V',
  dong_dien_a: 'A',
  nhiet_do_c: '°C',
  dong_ro_ma: 'mA',
};
const alertOperatorLabels: Record<string, string> = {
  '>': 'lớn hơn',
  '<': 'nhỏ hơn',
  '>=': 'lớn hơn hoặc bằng',
  '<=': 'nhỏ hơn hoặc bằng',
  '=': 'bằng',
};
function formatAlertCondition(rule: Row) {
  const metric = alertMetricLabels[rule.chi_so_can_do] || rule.chi_so_can_do;
  const unit = alertMetricUnits[rule.chi_so_can_do] || '';
  const operator = alertOperatorLabels[rule.toan_tu] || rule.toan_tu;
  return `${metric} (${unit}) ${operator} ${fmt(rule.gia_tri_nguong)} ${unit}`.trim();
}
function Login({ done }: { done: (u: Row) => void }) {
  const [name, setName] = useState('admin'),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: any) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('auth/login', 'POST', {
        tai_khoan: name,
        mat_khau: password,
      });
      sessionStorage.setItem('energy-token', r.access_token);
      done(r.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <div className="brand">
          <Icon name="energy" />
          <span>
            Smart Energy<span className="brand-sub">BUILDING INTELLIGENCE</span>
          </span>
        </div>
        <div>
          <div className="eyebrow">NĂNG LƯỢNG TRONG TẦM KIỂM SOÁT</div>
          <h1>
            Hiểu từng watt.
            <br />
            Chủ động từng giờ.
          </h1>
          <p>
            Theo dõi điện năng, phát hiện bất thường và điều khiển thiết bị trên
            cùng một không gian.
          </p>
          <div className="story-line">
            <span>01 · Giám sát</span>
            <span>02 · Cảnh báo</span>
            <span>03 · Điều khiển</span>
          </div>
        </div>
        <small>SMART ENERGY IOT / NHÓM 19 – 1A</small>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập hệ thống</h2>
          <p className="muted">Sử dụng tài khoản đã được quản trị viên cấp.</p>
          <label>
            Tài khoản
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary wide" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập →'}
          </button>
          <p className="help">
            Mật khẩu lần đầu được tạo bởi lệnh <code>npm run setup</code> trong
            hướng dẫn cài đặt.
          </p>
        </form>
      </section>
    </div>
  );
}
const labels: Record<string, string> = {
  dashboard: 'Tổng quan',
  map: 'Bản đồ nhiệt',
  alert: 'Cảnh báo',
  control: 'Điều khiển',
  schedule: 'Lịch hẹn giờ',
  logs: 'Nhật ký',
  catalog: 'Quản trị',
};
const titles: Record<string, string> = {
  dashboard: 'Năng lượng tòa nhà',
  map: 'Mức tiêu thụ theo không gian',
  alert: 'Cảnh báo & bất thường',
  control: 'Điều khiển thiết bị',
  schedule: 'Tự động theo lịch',
  logs: 'Lịch sử điều khiển',
  catalog: 'Danh mục hệ thống',
};
function App() {
  const [user, setUser] = useState<Row | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [tab, setTab] = useState(new URLSearchParams(location.search).has('alert') ? 'alert' : 'dashboard'),
    [connected, setConnected] = useState(false);
  const [data, setData] = useState<Row>({
      devices: [],
      heatmap: [],
      total: 0,
      online: 0,
      totalPowerW: 0,
      onlineRooms: 0,
      totalRooms: 0,
    }),
    [lists, setLists] = useState<Row>({
      buildings: [],
      floors: [],
      rooms: [],
      devices: [],
      users: [],
    });
  const [alerts, setAlerts] = useState<Row[]>([]),
    [rules, setRules] = useState<Row[]>([]),
    [schedules, setSchedules] = useState<Row[]>([]),
    [logs, setLogs] = useState<Row[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<Row[]>([]);
  const [deviceSetup, setDeviceSetup] = useState<Row | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const [notice, setNotice] = useState(''),
    [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success'),
    [commandPopup, setCommandPopup] = useState<Row | null>(null),
    [bellOpen, setBellOpen] = useState(false),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState<any>(null),
    [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(''),
    [selectedDevice, setSelectedDevice] = useState(''),
    [samples, setSamples] = useState<Row[]>([]),
    [energy, setEnergy] = useState<Row[]>([]),
    [period, setPeriod] = useState('day');

  useEffect(() => {
    if (!bellOpen) return;
    const outside = (event: PointerEvent) => {
      if (!bellRef.current?.contains(event.target as Node)) setBellOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBellOpen(false);
        bellRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [bellOpen]);
  const manager = user && user.vai_tro !== 'NguoiXem';
  const admin = user?.vai_tro === 'Admin';
  const refreshTimer = useRef<any>(null);
  const commandResults = useRef(new Map<string, Row>());
  const commandPolls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    commandPolls.current.forEach(clearTimeout);
    commandPolls.current.clear();
    commandResults.current.clear();
  }, [user]);
  const logout = useCallback(() => {
    sessionStorage.removeItem('energy-token');
    setCommandPopup(null);
    setDeviceSetup(null);
    setBellOpen(false);
    setActiveAlerts([]);
    setUser(null);
    setTab('dashboard');
    setDialog(null);
    setBuilding('');
    setSelectedDevice('');
  }, []);
  useEffect(() => {
    window.addEventListener('energy-logout', logout);
    if (getToken())
      api('auth/me')
        .then(setUser)
        .catch(() => {})
        .finally(() => setAuthLoading(false));
    else setAuthLoading(false);
    return () => window.removeEventListener('energy-logout', logout);
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const names = [
        'buildings',
        'floors',
        'rooms',
        'devices',
        ...(admin ? ['users'] : []),
      ];
      const [dash, active, ...values] = await Promise.all([
        api('dashboard'),
        api('alerts/active'),
        ...names.map((x) => api(x)),
      ]);
      setData(dash);
      setActiveAlerts(active);
      setLists(Object.fromEntries(names.map((n, i) => [n, values[i]])));
      if (manager) {
        const [a, r, s, l] = await Promise.all([
          api('alerts/history'),
          api('alerts/rules'),
          api('control/schedules'),
          api('control/logs'),
        ]);
        const linkedId = new URLSearchParams(location.search).get('alert');
        const linked = linkedId && !a.some((item: Row) => item._id === linkedId)
          ? await api('alerts/history?id=' + encodeURIComponent(linkedId)) : [];
        setAlerts([...a, ...linked]);
        setRules(r);
        setSchedules(s);
        setLogs(l);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [user, admin, manager]);
  useEffect(() => {
    if (!user) return;
    load();
    const timer = setInterval(load, 5000);
    const socket = io({
      transports: ['websocket'],
      auth: { token: getToken() },
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    const update = () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(load, 250);
    };
    socket.on('telemetry', update);
    socket.on('command', (command: any) => {
      showCommandResult(command);
      update();
    });
    socket.on('alert', (e: any) => {
      setNoticeTone('success');
      setNotice(e.message || 'Trạng thái cảnh báo đã cập nhật');
      update();
    });
    return () => {
      clearInterval(timer);
      clearTimeout(refreshTimer.current);
      socket.disconnect();
    };
  }, [user, load]);
  const visibleDevices = data.devices.filter(
    (d: Row) => !building || d.buildingId === building,
  );
  const deviceId = visibleDevices.some((d: Row) => d._id === selectedDevice) ? selectedDevice : visibleDevices[0]?._id;
  useEffect(() => {
    setSamples([]);
    if (!user || !deviceId) return;
    let stop = false;
    async function fetchHistory() {
      try {
        const now = new Date(),
          from = new Date(+now - 15 * 60000);
        const r = await api(
          `telemetry/device/${deviceId}/history?from=${from.toISOString()}&to=${now.toISOString()}`,
        );
        if (!stop) setSamples(r.data);
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    fetchHistory();
    const t = setInterval(fetchHistory, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user, deviceId]);
  useEffect(() => {
    if (!user) return;
    let stop = false;
    setEnergy([]);
    async function fetchEnergy() {
      try {
        const end = Math.floor(Date.now() / 3600000) * 3600000;
        const days = period === 'day' ? 7 : period === 'week' ? 28 : 90;
        const r = await api(
          `analytics/energy?from=${new Date(end - days * 86400000).toISOString()}&to=${new Date(end).toISOString()}&period=${period}${building ? '&buildingId=' + building : ''}`,
        );
        if (!stop) setEnergy(r.data);
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    fetchEnergy();
    const t = setInterval(fetchEnergy, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user, building, period]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 7000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  function showCommandResult(command: Row) {
    const id = command._id || command.ma_lenh;
    if (id && commandResults.current.has(id)) return;
    if (id && ['Thành công', 'Thất bại'].includes(command.trang_thai)) {
      commandResults.current.set(id, command);
      clearTimeout(commandPolls.current.get(id));
      commandPolls.current.delete(id);
    }
    // An uncertain timeout can later be replaced by an authoritative ACK.
    if (command.trang_thai === 'Chưa xác định') {
      setCommandPopup((previous) => previous?._id === id && previous.trang_thai === 'Chưa xác định' ? previous : command);
      return;
    }
    setCommandPopup(command);
    if (command.trang_thai === 'Thành công') {
      setNoticeTone('success');
      setNotice(`Lệnh ${command.hanh_dong} đã thực hiện thành công`);
    } else if (command.trang_thai === 'Thất bại') {
      setNoticeTone('error');
      setNotice(
        `Lệnh ${command.hanh_dong} thất bại: ${
          command.loi || 'Thiết bị không xác nhận được lệnh'
        }`,
      );
    }
  }
  function watchCommand(command: Row) {
    const commandId = command._id || command.ma_lenh;
    if (!commandId || commandResults.current.has(commandId) || commandPolls.current.has(commandId)) return;

    let attempts = 0;
    const poll = async () => {
      if (!commandPolls.current.has(commandId)) return;
      if (attempts++ >= 30) {
        commandPolls.current.delete(commandId);
        setCommandPopup({ ...command, trang_thai: 'Chưa xác định', loi: 'Chưa lấy được kết quả. Kiểm tra kết nối và nhật ký trước khi gửi lại lệnh.' });
        return;
      }
      try {
        const current = await api('control/commands/' + encodeURIComponent(commandId), 'GET', undefined, AbortSignal.timeout(3000));
        if (!commandPolls.current.has(commandId)) return;
        if (current?.trang_thai === 'Chưa xác định') showCommandResult(current);
        if (
          current?.trang_thai === 'Thành công' ||
          current?.trang_thai === 'Thất bại'
        ) {
          showCommandResult(current);
          await load();
          return;
        }
      } catch {}
      if (commandPolls.current.has(commandId)) commandPolls.current.set(commandId, setTimeout(poll, 500));
    };
    commandPolls.current.set(commandId, setTimeout(poll, 500));
  }
  async function change(
    path: string,
    method: string,
    payload?: any,
    message = 'Đã cập nhật',
  ) {
    setSaving(true);
    setError('');
    try {
      const result = await api(path, method, payload, path.includes('/switch') ? AbortSignal.timeout(10000) : undefined);
      if (path.includes('/switch')) {
        showCommandResult(result);
      }
      if (!path.includes('/switch')) {
        setNoticeTone(result.trang_thai === 'Thất bại' ? 'error' : 'success');
        setNotice(
          result.trang_thai === 'Thất bại'
            ? 'Lệnh thất bại: ' + result.loi
            : message,
        );
      }
      if (path.includes('/switch')) {
        watchCommand(result);
      }
      setDialog(null);
      if (path === 'devices' && method === 'POST') setDeviceSetup(result);
      await load();
      return result;
    } catch (e: any) {
      setError(e.message);
      if (path.includes('/switch')) setCommandPopup({ hanh_dong: payload?.hanh_dong, trang_thai: 'Chưa xác định', loi: e.message + '. Kiểm tra nhật ký trước khi gửi lại lệnh.' });
      throw e;
    } finally {
      setSaving(false);
    }
  }
  const run = (...args: Parameters<typeof change>) =>
    change(...args).catch(() => {});
  const edit = (kind: string, record?: Row) => { setError(''); setDialog({ kind, record }); };
  if (authLoading)
    return <div className="loading">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <Login done={setUser} />;
  const power = visibleDevices
    .filter((d: Row) => d.online)
    .reduce((s: number, d: Row) => s + (d.latest?.cong_suat_w || 0), 0);
  const selected = visibleDevices.find((d: Row) => d._id === deviceId);
  const selectedOnline = !!selected?.online;
  const notifications = activeAlerts
      .map((item) => ({
        id: `alert-${item._id}`,
        title: item.snapshot?.rule?.ten_quy_tac || 'Cảnh báo năng lượng',
        detail: item.noi_dung_loi || item.tinh_trang || 'Có bất thường cần kiểm tra',
        time: item.thoi_gian_phat_hien,
        state: item.tinh_trang === 'Đang phục hồi' ? 'Đang theo dõi phục hồi' : 'Đang diễn ra',
        tone: 'danger',
      }));
  const notificationCount = notifications.length;
  const chartOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 20, top: 28, bottom: 42 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#cad6d0' } },
      axisLabel: { color: '#7c8983' },
    },
    yAxis: {
      type: 'value',
      name: 'W',
      splitLine: { lineStyle: { color: '#edf1ee' } },
      axisLabel: { color: '#7c8983' },
    },
    series: [
      {
        type: 'line',
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: '#258369', width: 2.5 },
        areaStyle: { color: '#c5e7d7', opacity: 0.45 },
        data: samples.map((s) => [s.thoi_gian_do, s.cong_suat_w]),
      },
    ],
  };
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <Icon name="energy" />
          <span>
            Smart Energy<span className="brand-sub">BUILDING INTELLIGENCE</span>
          </span>
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {Object.entries(labels)
            .filter(([key]) =>
              key === 'catalog'
                ? admin
                : ['alert', 'control', 'schedule', 'logs'].includes(key)
                  ? manager
                  : true,
            )
            .map(([key, text]) => (
              <button
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => setTab(key)}
              >
                <Icon name={key} />
                {text}
                {key === 'alert' &&
                  alerts.some((a) => a.isOpen ?? a.tinh_trang !== 'Đã kết thúc') && (
                    <span className="nav-dot" />
                  )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-line">
            <i className={connected ? 'dot live' : 'dot'} />
            {connected ? 'Đang kết nối trực tiếp' : 'Đang kết nối lại'}
          </div>
          <div className="profile">
            <div className="avatar">{user.ho_ten?.slice(0, 1)}</div>
            <div>
              <strong>{user.ho_ten}</strong>
              <small>
                {user.vai_tro === 'Admin'
                  ? 'Quản trị viên'
                  : manager
                    ? 'Quản lý'
                    : 'Người xem'}
              </small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            Đăng xuất ↗
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">
              SMART ENERGY / {labels[tab].toUpperCase()}
            </div>
            <h1>{titles[tab]}</h1>
            <p className="muted">
              {new Date().toLocaleDateString('vi-VN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · Giờ Việt Nam
            </p>
          </div>
          <div className="header-tools">
            <span className="live-label">
              <i className={connected ? 'dot live' : 'dot'} />
              {connected ? 'Trực tiếp' : 'Đang kết nối'}
            </span>
            <a
              className="link-button"
              href="/docs"
              target="_blank"
              rel="noreferrer"
            >
              API Docs ↗
            </a>
            <div className="notification-wrap" ref={bellRef}>
              <button
                className="notification-button"
                aria-label={`Cảnh báo đang diễn ra: ${notificationCount}`}
                aria-expanded={bellOpen}
                aria-controls="active-alert-notifications"
                onClick={() => setBellOpen((open) => !open)}
              >
                <Icon name="bell" />
                {notificationCount > 0 && (
                  <span className="notification-count">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <section id="active-alert-notifications" className="notification-menu" aria-label="Cảnh báo đang diễn ra">
                  <div className="notification-head">
                    <strong>Cảnh báo đang diễn ra</strong>
                    <span>{notificationCount} cảnh báo</span>
                  </div>
                  {notifications.length ? (
                    notifications.map((item) => (
                      <div className="notification-item" key={item.id}>
                        <i className={`notification-mark ${item.tone}`} />
                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.detail}</span>
                          <small>{item.state}</small>
                          <small>{date(item.time)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="notification-empty">Không có cảnh báo đang diễn ra</p>
                  )}
                  <p className="notification-empty">Cảnh báo tự biến mất khi hệ thống xác nhận thông số đã phục hồi.</p>
                </section>
              )}
            </div>
          </div>
        </header>
        {commandPopup && (
          <div
            className={`command-popup ${
              commandPopup.trang_thai === 'Thành công'
                ? 'success'
                : commandPopup.trang_thai === 'Thất bại'
                  ? 'failure'
                  : 'pending'
            }`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <strong>
              {['Đang chờ', 'Đã gửi'].includes(commandPopup.trang_thai)
                ? 'Đang chờ thiết bị xác nhận'
                : commandPopup.trang_thai}
            </strong>
            <span>
              Lệnh {commandPopup.hanh_dong}
              {commandPopup.ma_thiet_bi && ` · ${lists.devices.find((d: Row) => d._id === commandPopup.ma_thiet_bi)?.ten_thiet_bi || commandPopup.ma_thiet_bi}`}
              {['Thất bại', 'Chưa xác định'].includes(commandPopup.trang_thai) &&
                `: ${commandPopup.loi || 'Không nhận được xác nhận'}`}
            </span>
            <button
              aria-label="Đóng thông báo điều khiển"
              onClick={() => setCommandPopup(null)}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className={`notice ${noticeTone}`} role="status">
            {notice}
            <button onClick={() => setNotice('')}>×</button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}
        <div className="toolbar">
          <div>
            <span className="muted">Phạm vi giám sát</span>
            <select
              value={building}
              onChange={(e) => {
                setBuilding(e.target.value);
                setSelectedDevice('');
              }}
            >
              <option value="">Tất cả tòa nhà được cấp quyền</option>
              {lists.buildings?.map((b: Row) => (
                <option key={b._id} value={b._id}>
                  {b.ten_toa_nha}
                </option>
              ))}
            </select>
          </div>
          <span className="muted small">Cập nhật: {date(data.serverTime)}</span>
        </div>
        {tab === 'dashboard' && (
          <>
            <div className="metrics">
              <Metric
                label="CÔNG SUẤT HIỆN TẠI"
                value={fmt(power / 1000, 2)}
                unit="kW"
                detail="Tổng công suất của các gateway phòng đang online"
                featured
              />
              <Metric
                label="PHÒNG ĐANG KẾT NỐI"
                value={String(
                  data.heatmap.filter(
                    (r: Row) => (!building || r.buildingId === building) && r.online,
                  ).length,
                )}
                unit={
                  '/ ' +
                  data.heatmap.filter(
                    (r: Row) => !building || r.buildingId === building,
                  ).length
                }
                detail="Phòng Online khi gateway nhận telemetry; mất dữ liệu quá 5 chu kỳ sẽ Offline"
              />
              <Metric
                label="ĐIỆN NĂNG TRONG KỲ"
                value={fmt(
                  energy.reduce((s, x) => s + x.dien_nang_kwh, 0),
                  3,
                )}
                unit="kWh"
                detail={
                  period === 'day'
                    ? '7 ngày, đến đầu giờ hiện tại'
                    : period === 'week'
                      ? '28 ngày, đến đầu giờ hiện tại'
                      : '90 ngày, đến đầu giờ hiện tại'
                }
              />
              <Metric
                label={manager ? 'CẢNH BÁO CHƯA XỬ LÝ' : 'PHÒNG GIÁM SÁT'}
                value={String(
                  manager
                    ? alerts.filter(
                        (x) =>
                          x.tinh_trang !== 'Đã kết thúc' &&
                          (!building || x.buildingId === building),
                      ).length
                    : data.heatmap.filter(
                        (x: Row) => !building || x.buildingId === building,
                      ).length,
                )}
                unit=""
                detail={
                  manager
                    ? 'Cần kiểm tra và xác nhận'
                    : 'Trong phạm vi tài khoản'
                }
              />
            </div>
            <div className="chart-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Diễn biến công suất</h2>
                    <p className="muted small">
                      Dữ liệu đo trong 15 phút gần nhất
                    </p>
                  </div>
                  <select
                    value={deviceId || ''}
                    onChange={(e) => setSelectedDevice(e.target.value)}
                  >
                    {visibleDevices.map((d: Row) => (
                      <option key={d._id} value={d._id}>
                        {lists.rooms?.find((r: Row) => r._id === d.ma_phong)?.ten_phong ||
                          d.ten_thiet_bi}
                      </option>
                    ))}
                  </select>
                </div>
                {samples.length ? (
                  <Chart option={chartOption} />
                ) : (
                  <Empty text="Đang chờ dữ liệu từ gateway phòng…" />
                )}
              </section>
              <section className="panel gateway-panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow gateway-eyebrow">GIÁM SÁT ĐIỆN NĂNG</p>
                    <h2>Thông số điện trong phòng</h2>
                  </div>
                  <Badge value={selectedOnline} />
                </div>
                {selectedOnline ? (
                  <>
                    <Chart
                      height={200}
                      option={{
                        series: [
                          {
                            type: 'gauge',
                            min: 0,
                            max: selected?.cong_suat_dinh_muc || 2000,
                            progress: {
                              show: true,
                              width: 12,
                              itemStyle: { color: '#2f8b70' },
                            },
                            axisLine: {
                              lineStyle: { width: 12, color: [[1, '#edf2ee']] },
                            },
                            splitLine: { show: false },
                            axisTick: { show: false },
                            axisLabel: { show: false },
                            pointer: { show: false },
                            anchor: { show: false },
                            detail: {
                              fontSize: 25,
                              color: '#183b30',
                              formatter: '{value} W',
                              offsetCenter: [0, '10%'],
                            },
                            title: { show: false },
                            data: [
                              {
                                value: Math.round(
                                  selected?.latest?.cong_suat_w || 0,
                                ),
                              },
                            ],
                          },
                        ],
                      }}
                    />
                    <div className="readings gateway-readings">
                      <span>
                        Điện áp
                        <strong>
                          {fmt(selected?.latest?.dien_ap_v, 1)} <small>V</small>
                        </strong>
                      </span>
                      <span>
                        Dòng điện
                        <strong>
                          {fmt(selected?.latest?.dong_dien_a, 2)} <small>A</small>
                        </strong>
                      </span>
                      <span>
                        Nhiệt độ
                        <strong>
                          {fmt(selected?.latest?.nhiet_do_c, 1)} <small>°C</small>
                        </strong>
                      </span>
                    </div>
                    {selected?.latest?.chi_tiet_mo_phong && (
                      <div className="readings gateway-readings loads">
                        {Object.entries(selected.latest.chi_tiet_mo_phong).map(
                          ([name, value]) => (
                            <span key={name}>
                              {({ den: 'Đèn chiếu sáng', quat: 'Quạt', may_lanh_1: 'Máy lạnh 1', may_lanh_2: 'Máy lạnh 2', may_chieu: 'Máy chiếu', o_cam: 'Ổ cắm' } as Record<string, string>)[name] || name.replaceAll('_', ' ')}
                              <strong>
                                {fmt(Number(value))} <small>W</small>
                              </strong>
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    <p className="muted small last-reading">
                      Cập nhật lúc: {date(
                        selected?.latest?.receivedAt ||
                          selected?.latest?.thoi_gian_do,
                      )}
                    </p>
                  </>
                ) : (
                  <div className="offline-state">
                    <div className="offline-icon">!</div>
                    <div>
                      <strong>Bộ giám sát đang mất kết nối</strong>
                      <p className="muted small">
                        Chưa nhận được dữ liệu đo trong 5 chu kỳ gửi.
                      </p>
                    </div>
                    <div className="offline-divider" />
                    <p className="muted small">
                      Bản đo cuối<br />
                      <strong>
                        {date(
                          selected?.latest?.receivedAt ||
                            selected?.latest?.thoi_gian_do,
                        )}
                      </strong>
                    </p>
                  </div>
                )}
              </section>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Điện năng tiêu thụ</h2>
                  <p className="muted small">
                    Tổng hợp theo giờ · Không nội suy khoảng mất kết nối dài
                  </p>
                </div>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="day">Theo ngày · 7 ngày</option>
                  <option value="week">Theo tuần · 28 ngày</option>
                  <option value="month">Theo tháng · 90 ngày</option>
                </select>
              </div>
              {energy.length ? (
                <Chart
                  height={240}
                  option={{
                    tooltip: { trigger: 'axis' },
                    grid: { left: 55, right: 20, top: 25, bottom: 35 },
                    xAxis: {
                      type: 'category',
                      data: energy.map((x) =>
                        new Date(x._id).toLocaleDateString('vi-VN'),
                      ),
                    },
                    yAxis: {
                      type: 'value',
                      name: 'kWh',
                      splitLine: { lineStyle: { color: '#edf1ee' } },
                    },
                    series: [
                      {
                        type: 'bar',
                        barMaxWidth: 34,
                        itemStyle: {
                          color: '#43967a',
                          borderRadius: [5, 5, 0, 0],
                        },
                        data: energy.map((x) => +x.dien_nang_kwh.toFixed(4)),
                      },
                    ],
                  }}
                />
              ) : (
                <Empty text="Chưa có dữ liệu tổng hợp. Biểu đồ kỳ này chỉ tính các giờ đã kết thúc." />
              )}
            </section>
          </>
        )}
        {tab === 'map' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Bản đồ nhiệt theo phòng</h2>
                <p className="muted">
                  Màu theo tỷ lệ công suất hiện tại / tổng công suất định mức
                </p>
              </div>
              <div className="legend">
                <span>● &lt;50%</span>
                <span>● 50–80%</span>
                <span>● &gt;80%</span>
              </div>
            </div>
            <div className="heatmap">
              {data.heatmap
                .filter((r: Row) => !building || r.buildingId === building)
                .map((r: Row) => (
                  <article
                    key={r.ma_phong}
                    className={'heat ' + r.muc_do_canh_bao}
                  >
                    <div>
                      {r.ten_phong}
                      <small>
                        Tầng{' '}
                        {
                          lists.floors?.find((f: Row) => f._id === r.ma_tang)
                            ?.so_tang
                        }
                      </small>
                    </div>
                    <strong>
                      {fmt(r.tong_cong_suat_w / 1000, 2)} <small>kW</small>
                    </strong>
                    <span>
                      {r.online ? 'Gateway phòng online' : 'Gateway phòng offline'}
                    </span>
                  </article>
                ))}
            </div>
          </section>
        )}
        {tab === 'control' && (
          <>
            <p className="info-text">
              Lệnh chuyển sang “Thành công” sau khi thiết bị xác nhận. Nếu quá 10
              giây chưa có ACK, kết quả là “Chưa xác định”; ACK đến muộn sẽ cập nhật
              lại kết quả theo phản hồi thiết bị.
            </p>
            <div className="device-grid">
              {visibleDevices.map((d: Row) => (
                <section className="panel device" key={d._id}>
                  <div className="panel-head">
                    <span className="device-icon">
                      <Icon name="control" />
                    </span>
                    <Badge value={d.online} />
                  </div>
                  <h2>
                    Gateway ·{' '}
                    {lists.rooms?.find((r: Row) => r._id === d.ma_phong)
                      ?.ten_phong || d.ten_thiet_bi}
                  </h2>
                  <p className="muted">
                    {
                      lists.rooms?.find((r: Row) => r._id === d.ma_phong)
                        ?.ten_phong
                    }
                  </p>
                  <div className="device-power">
                    {fmt(d.latest?.cong_suat_w)} <small>W</small>
                  </div>
                  <div className="device-state">
                    Relay báo về:{' '}
                    <strong>
                      {d.trang_thai_relay === undefined
                        ? 'Chưa có'
                        : d.trang_thai_relay
                          ? 'Bật'
                          : 'Tắt'}
                    </strong>
                  </div>
                  {d.pendingCommand ? (
                    <p className="pending">Đang chờ phản hồi thiết bị…</p>
                  ) : (
                    <div className="button-row">
                      <button
                        disabled={!d.online || !d.cho_phep_dieu_khien || saving}
                        onClick={() =>
                          run(
                            `control/devices/${d._id}/switch`,
                            'POST',
                            { hanh_dong: 'Bật' },
                            'Đã tạo lệnh Bật; đang chờ ACK',
                          )
                        }
                      >
                        Bật
                      </button>
                      <button
                        disabled={!d.online || !d.cho_phep_dieu_khien || saving}
                        onClick={() =>
                          run(
                            `control/devices/${d._id}/switch`,
                            'POST',
                            { hanh_dong: 'Tắt' },
                            'Đã tạo lệnh Tắt; đang chờ ACK',
                          )
                        }
                      >
                        Tắt
                      </button>
                    </div>
                  )}
                </section>
              ))}
            </div>
            {!visibleDevices.length && (
              <Empty text="Chưa có thiết bị trong phạm vi này" />
            )}
          </>
        )}
        {tab === 'alert' && (
          <AlertPage
            alerts={alerts.filter(
              (a) => !building || a.buildingId === building,
            )}
            rules={rules.filter((a) => !building || a.buildingId === building)}
            devices={data.devices}
            roomList={lists.rooms}
            edit={edit}
            run={run}
            saving={saving}
          />
        )}
        {tab === 'schedule' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Lịch điều khiển</h2>
                <p className="muted small">
                  Mỗi lịch thực hiện một hành động · Múi giờ Asia/Ho_Chi_Minh
                </p>
              </div>
              <button className="primary" onClick={() => edit('schedules')}>
                + Thêm lịch
              </button>
            </div>
            <Table
              heads={[
                'Thiết bị',
                'Hành động',
                'Giờ',
                'Ngày lặp',
                'Trạng thái',
                'Thao tác',
              ]}
              rows={schedules
                .filter((s) => !building || s.buildingId === building)
                .map((s) => [
                  data.devices.find((d: Row) => d._id === s.ma_thiet_bi)
                    ?.ten_thiet_bi,
                  s.hanh_dong,
                  s.gio_bat_dau,
                  s.ngay_lap_lai,
                  <Badge value={s.bat ? 'Đang bật' : 'Đang tắt'} />,
                  <div className="actions">
                    <button onClick={() => edit('schedules', s)}>Sửa</button>
                    <button
                      onClick={() =>
                        run('control/schedules/' + s._id, 'PATCH', {
                          bat: !s.bat,
                        })
                      }
                    >
                      {s.bat ? 'Tạm dừng' : 'Kích hoạt'}
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        confirm('Xóa lịch hẹn giờ này?') &&
                        run('control/schedules/' + s._id, 'DELETE')
                      }
                    >
                      Xóa
                    </button>
                  </div>,
                ])}
            />
          </section>
        )}
        {tab === 'logs' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Nhật ký lệnh</h2>
                <p className="muted small">
                  Tối đa 500 lệnh gần nhất · Trạng thái lấy từ phản hồi thiết bị
                </p>
              </div>
            </div>
            <Table
              heads={[
                'Thời điểm',
                'Thiết bị',
                'Lệnh',
                'Nguồn',
                'Kết quả',
                'Chi tiết',
              ]}
              rows={logs
                .filter((l) => !building || l.buildingId === building)
                .map((l) => [
                  date(l.thoi_gian_thuc_hien),
                  data.devices.find((d: Row) => d._id === l.ma_thiet_bi)
                    ?.ten_thiet_bi || l.ma_thiet_bi,
                  l.hanh_dong,
                  l.nguon,
                  <Badge value={l.trang_thai} />,
                  l.loi ||
                    (l.lateAck
                      ? 'Có ACK đến muộn'
                      : l.ack
                        ? 'Đã đối chiếu ACK'
                        : 'Đang chờ'),
                ])}
            />
          </section>
        )}
        {tab === 'catalog' && (
          <CatalogPage building={building} lists={lists} edit={edit} run={run} setup={setDeviceSetup} />
        )}
        <footer>
          SMART ENERGY IOT <span>Giám sát · Cảnh báo · Điều khiển</span>
        </footer>
      </main>
      {deviceSetup && <DeviceSetup device={lists.devices?.find((d: Row) => d._id === deviceSetup._id) || deviceSetup} rooms={lists.rooms || []} close={() => setDeviceSetup(null)} />}
      {dialog && (
        <Editor
          kind={dialog.kind}
          record={dialog.record}
          lists={lists}
          busy={saving}
          error={error}
          close={() => {
            setDialog(null);
            setError('');
          }}
          save={(payload: any) =>
            change(
              (dialog.kind === 'rules'
                ? 'alerts/rules'
                : dialog.kind === 'schedules'
                  ? 'control/schedules'
                  : dialog.kind) +
                (dialog.record ? '/' + dialog.record._id : ''),
              dialog.record ? 'PATCH' : 'POST',
              payload,
              'Đã lưu dữ liệu',
            )
          }
        />
      )}
    </div>
  );
}
function Metric({ label, value, unit, detail, featured = false }: any) {
  return (
    <section className={'metric ' + (featured ? 'featured' : '')}>
      <div className="metric-label">{label}</div>
      <div className="metric-number">
        {value}
        <small>{unit}</small>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function Empty({ text }: any) {
  return <div className="empty">{text}</div>;
}
function Table({ heads, rows }: any) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {heads.map((h: string) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any[], i: number) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td key={j}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="Chưa có dữ liệu phù hợp" />
  );
}
function AlertPage({
  alerts,
  rules,
  devices,
  roomList,
  edit,
  run,
  saving,
}: any) {
  const [focusedAlert, setFocusedAlert] = useState(new URLSearchParams(location.search).get('alert') || ''),
    [severity, setSeverity] = useState(''),
    [room, setRoom] = useState(''),
    [incidentState, setIncidentState] = useState(new URLSearchParams(location.search).has('alert') ? '' : 'active'),
    [since, setSince] = useState('');
  const roomIds = [...new Set<string>(devices.map((d: Row) => d.ma_phong))];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Sự cố cần theo dõi</h2>
            <p className="muted small">
              Thông số phục hồi khi nằm liên tục trong vùng phục hồi, mặc định 30 giây.
              Đây là kết luận theo dữ liệu đo, không phải xác nhận an toàn điện.
            </p>
          </div>
        </div>
        <div className="filters">
          {focusedAlert && <button onClick={() => {
            setFocusedAlert('');
            const url = new URL(location.href); url.searchParams.delete('alert');
            history.replaceState(null, '', url);
          }}>Bỏ lọc mã sự cố</button>}
          <select
            value={incidentState}
            onChange={(e) => setIncidentState(e.target.value)}
          >
            <option value="active">Chưa phục hồi hoàn toàn</option>
            <option value="recovering">Đang phục hồi</option>
            <option value="ended">Thông số đã phục hồi</option>
            <option value="">Tất cả sự cố</option>
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">Tất cả mức độ</option>
            {[
              ['LOW', 'Thấp'],
              ['MEDIUM', 'Trung bình'],
              ['HIGH', 'Cao'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Tất cả phòng</option>
            {roomIds.map((r) => (
              <option key={r} value={r}>
                {roomList.find((item: Row) => item._id === r)?.ten_phong ||
                  `Phòng ${r}`}
              </option>
            ))}
          </select>
          <label className="inline-label">
            Từ ngày
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </label>
        </div>
        <Table
          heads={[
            'Thời điểm',
            'Nội dung',
            'Mức độ',
            'Tình trạng',
            'Telegram',
          ]}
          rows={alerts
            .filter(
              (a: Row) =>
                (!incidentState ||
                  (incidentState === 'active'
                    ? (a.isOpen ?? a.tinh_trang !== 'Đã kết thúc')
                    : incidentState === 'recovering' ? a.tinh_trang === 'Đang phục hồi'
                    : a.tinh_trang === 'Đã kết thúc')) &&
                (!focusedAlert || a._id === focusedAlert) &&
                (!severity || a.muc_do === severity) &&
                (!room || a.ma_phong === room) &&
                (!since || new Date(a.thoi_gian_phat_hien) >= new Date(since)),
            )
            .map((a: Row) => [
                <span className="wrap">
                  <span>Bắt đầu: {date(a.thoi_gian_phat_hien)}</span>
                  {a.tinh_trang === 'Đã kết thúc' && (
                    <small>Kết thúc: {date(a.ket_thuc_luc || a.lastSeen)}</small>
                  )}
                </span>,
              <span className="wrap">
                {alertMessage(a, devices, roomList)}
                <small>Mã: {a._id}</small>
                {a.supersededBy && <small>Đã gộp vào cảnh báo {a.supersededBy}</small>}
                <small>{a.occurrences} lần ghi nhận</small>
                <small>Số đo cập nhật: {date(a.lastSeen)}</small>
                {a.tinh_trang !== 'Đã kết thúc' && a.lastSeen &&
                  Date.now() - +new Date(a.lastSeen) >
                    (devices.find((d: Row) => d._id === a.ma_thiet_bi)?.chu_ky_gui || 5) * 5000 &&
                  <small>Thiếu số đo mới — chưa thể xác nhận phục hồi</small>}
                {a.monitoringPaused && <small>Quy tắc tạm dừng — chưa xác nhận phục hồi</small>}
                {a.outsideWindow && a.tinh_trang !== 'Đã kết thúc' && <small>Ngoài khung giờ nhắc; tiếp tục kiểm tra phục hồi</small>}
                {a.tinh_trang === 'Đang phục hồi' && <small>
                  Cần ổn định liên tục {a.recoverySeconds || 30} giây; đang chờ mẫu đo xác nhận
                </small>}
              </span>,
              <Badge value={a.muc_do} />,
              <Badge
                value={alertIncidentLabels[a.tinh_trang] || 'Đang diễn ra'}
              />,
              <span className="wrap">
                <small>Cảnh báo / nhắc</small><Badge value={a.trang_thai_gui || 'Chưa gửi'} />
                {a.recoveryNotification && <><small>Phục hồi</small>
                  <Badge value={a.recoveryNotification.trang_thai_gui} /></>}
              </span>,
            ])}
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Quy tắc cảnh báo</h2>
            <p className="muted small">
              Chỉ phát cảnh báo khi vi phạm đủ thời gian duy trì
            </p>
          </div>
          <button className="primary" onClick={() => edit('rules')}>
            + Thêm quy tắc
          </button>
        </div>
        <Table
          heads={[
            'Tên quy tắc',
            'Điều kiện',
            'Ngưỡng phục hồi',
            'Duy trì',
            'Phục hồi',
            'Nhắc lại',
            'Trạng thái',
            'Thao tác',
          ]}
          rows={rules.map((r: Row) => [
            r.ten_quy_tac,
            formatAlertCondition(r),
            r.gia_tri_phuc_hoi == null ? 'Theo ngưỡng phát hiện' :
              `${['>', '>='].includes(r.toan_tu) ? '<' : '>'} ${r.gia_tri_phuc_hoi} ${alertMetricUnits[r.chi_so_can_do] || ''}`,
            r.thoi_gian_duy_tri + ' giây',
            (r.thoi_gian_phuc_hoi ?? 30) + ' giây',
            Math.max(r.cooldown || 300, 300) + ' giây',
            <Badge value={r.bat ? 'Đang bật' : 'Tạm dừng'} />,
            <div className="actions">
              <button onClick={() => edit('rules', r)}>Sửa</button>
              <button
                onClick={() =>
                  run('alerts/rules/' + r._id, 'PATCH', { bat: !r.bat })
                }
              >
                {r.bat ? 'Tắt' : 'Bật'}
              </button>
            </div>,
          ])}
        />
      </section>
    </>
  );
}
const kindLabels: Record<string, string> = {
  buildings: 'Tòa nhà',
  floors: 'Tầng',
  rooms: 'Phòng',
  devices: 'Thiết bị',
  users: 'Tài khoản',
  rules: 'Quy tắc cảnh báo',
  schedules: 'Lịch hẹn giờ',
};
function DeviceSetup({ device, rooms, close }: { device: Row; rooms: Row[]; close: () => void }) {
  const [copied, setCopied] = useState('');
  const room = rooms.find(r => r._id === device.ma_phong);
  const config = [
    `const char* DEVICE_ID = ${JSON.stringify(device._id)};`,
    `const char* ROOM_ID = ${JSON.stringify(room?.ten_phong || device.ma_phong)};`,
    `const char* TOPIC_BASE = ${JSON.stringify(device.chu_de_mqtt)};`,
    `const unsigned long SAMPLE_INTERVAL = ${(device.chu_ky_gui || 5) * 1000};`,
  ].join('\n');
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Đã sao chép.');
    } catch {
      setCopied('Không truy cập được clipboard. Chọn nội dung trong ô rồi nhấn Ctrl+C.');
    }
  }
  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true" aria-label="Kết nối ESP">
      <div className="panel-head"><h2>Kết nối ESP · {device.ten_thiet_bi}</h2><button autoFocus onClick={close} aria-label="Đóng hướng dẫn kết nối">×</button></div>
      <p role="status">{device.online ? '🟢 ESP đã kết nối — đang nhận dữ liệu.' : device.lastSeen ? 'ESP hiện offline. Kiểm tra mô phỏng và kết nối EMQX.' : 'Đang chờ ESP kết nối lần đầu…'}</p>
      <p>Phòng: <strong>{room?.ten_phong || device.ma_phong}</strong>. Thiết bị đã được đăng ký; chạy ESP với cấu hình dưới đây để bắt đầu nhận dữ liệu.</p>
      <ol>
        <li>Tạo bản sao dự án Wokwi đang dùng và mở <code>sketch.ino</code>.</li>
        <li>Thay các dòng cấu hình tương ứng bằng đoạn dưới đây. Giữ cấu hình EMQX giống ESP đang hoạt động.</li>
      </ol>
      <textarea aria-label="Cấu hình Wokwi" readOnly rows={5} value={config} style={{ width: '100%', fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
      <button type="button" onClick={() => copy(config)}>Sao chép cấu hình Wokwi</button>
      <p>Trong <code>connectMqtt()</code>, thay dòng tạo <code>clientId</code> bằng dòng sau để mỗi ESP có kết nối riêng:</p>
      <textarea aria-label="MQTT Client ID" readOnly rows={2} value={'String clientId = String("wokwi-energy-") + DEVICE_ID;'} style={{ width: '100%', fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
      <button type="button" onClick={() => copy('String clientId = String("wokwi-energy-") + DEVICE_ID;')}>Sao chép Client ID</button>
      <p>Chạy mô phỏng, kiểm tra thiết bị Online trên dashboard rồi thử bật/tắt. Mỗi ESP dùng một mã thiết bị và topic riêng; không dùng cấu hình này cho hai ESP cùng lúc.</p>
      <p role="status">{copied}</p>
      <div className="modal-actions"><button className="primary" onClick={close}>Đã hiểu</button></div>
    </section>
  </div>;
}

function CatalogPage({ lists, edit, run, setup, building }: any) {
  const [kind, setKind] = useState('buildings');
  const [deleting, setDeleting] = useState('');
  const location = (r: Row) => {
    const room = kind === 'rooms' ? r : lists.rooms?.find((x: Row) => x._id === r.ma_phong);
    const floor = kind === 'floors' ? r : lists.floors?.find((x: Row) => x._id === room?.ma_tang);
    const building = lists.buildings?.find((x: Row) => x._id === r.buildingId);
    return { room, floor, building };
  };
  const rows = (lists[kind] || []).filter((r: Row) => {
    if (!building) return true;
    if (kind === 'users') return r.vai_tro === 'Admin' || (r.buildingIds || []).includes(building);
    return (kind === 'buildings' ? r._id : r.buildingId) === building;
  }).sort((a: Row, b: Row) => String(a.ten_toa_nha || a.ten_phong || a.ten_thiet_bi || a.tai_khoan || a.so_tang).localeCompare(String(b.ten_toa_nha || b.ten_phong || b.ten_thiet_bi || b.tai_khoan || b.so_tang), 'vi', { numeric: true }));
  const fields: Record<string, string[]> = {
    buildings: ['ten_toa_nha', 'dia_chi'],
    floors: ['so_tang', 'ma_toa_nha'],
    rooms: ['ten_phong', 'ma_toa_nha', 'so_tang', 'loai_phong'],
    devices: ['ten_thiet_bi', 'ma_phong', 'online', 'chu_de_mqtt', 'chu_ky_gui'],
    users: ['tai_khoan', 'ho_ten', 'vai_tro', 'active'],
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="tabs">
          {Object.keys(fields).map((k) => (
            <button
              className={kind === k ? 'selected' : ''}
              onClick={() => setKind(k)}
              key={k}
            >
              {kindLabels[k]}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => edit(kind)}>
          + Thêm {kindLabels[kind].toLowerCase()}
        </button>
      </div>
      <Table
        heads={[
          ...fields[kind].map(
            (k) =>
              (
                ({
                  ten_toa_nha: 'Tên tòa nhà',
                  dia_chi: 'Địa chỉ',
                  so_tang: 'Tầng thứ',
                  ma_toa_nha: 'Tòa nhà',
                  ten_phong: 'Tên phòng',
                  loai_phong: 'Loại phòng',
                  ten_thiet_bi: 'Tên thiết bị',
                  ma_phong: 'Phòng',
                  online: 'Kết nối',
                  chu_de_mqtt: 'MQTT topic',
                  chu_ky_gui: 'Chu kỳ (giây)',
                  tai_khoan: 'Tài khoản',
                  ho_ten: 'Họ tên',
                  vai_tro: 'Vai trò',
                  active: 'Trạng thái',
                }) as any
              )[k],
          ),
          'Thao tác',
        ]}
        rows={rows.map((r: Row) => [
          ...fields[kind].map((k) =>
            k === 'active' ? (r.active === false ? 'Đã khóa' : 'Hoạt động')
              : k === 'so_tang' && kind === 'rooms' ? location(r).floor?.so_tang
              : k === 'online'
              ? (r.online ? 'Online' : r.lastSeen ? 'Offline' : 'Chưa kết nối')
              : k === 'ma_phong'
              ? lists.rooms.find((room: Row) => room._id === r[k])?.ten_phong
              : k === 'ma_toa_nha'
              ? lists.buildings.find((b: Row) => b._id === (r[k] || r.buildingId))?.ten_toa_nha
              : r[k],
          ),
          <div className="actions">
            {kind === 'devices' && <button onClick={() => setup(r)}>Kết nối ESP</button>}
            <button onClick={() => edit(kind, r)}>Sửa</button>
            <button
              className="danger"
              disabled={!!deleting || (kind === 'users' && r.active === false)}
              onClick={async () => {
                if (!confirm(
                  kind === 'users'
                    ? 'Khóa tài khoản này?'
                    : 'Xóa đối tượng này? Đối tượng có lịch sử sẽ không bị xóa.',
                )) return;
                setDeleting(r._id);
                try { await run(kind + '/' + r._id, 'DELETE'); } finally { setDeleting(''); }
              }}
            >
              {deleting === r._id ? 'Đang xử lý…' : kind === 'users' ? 'Khóa' : 'Xóa'}
            </button>
          </div>,
        ])}
      />
    </section>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  min?: number;
  max?: number;
  step?: string;
  hint?: string;
  fixed?: boolean;
};
function Editor({ kind, record, lists, busy, error, close, save }: any) {
  const opts = (k: string, label: string) =>
    (lists[k] || []).map((r: Row) => ({
      value: r._id,
      label: String(r[label]),
    }));
  const values = (a: string[]) => a.map((v) => ({ value: v, label: v }));
  const metricLabels: Record<string, string> = {
    cong_suat_w: 'Công suất (W)',
    dien_ap_v: 'Điện áp (V)',
    dong_dien_a: 'Dòng điện (A)',
    nhiet_do_c: 'Nhiệt độ (°C)',
  };
  const severityLabels: Record<string, string> = {
    LOW: 'Thấp',
    MEDIUM: 'Trung bình',
    HIGH: 'Cao',
  };
  const deviceField = {
    key: 'ma_thiet_bi',
    label: 'Thiết bị',
    options: opts('devices', 'ten_thiet_bi'),
  };
  const definitions: Record<string, Field[]> = {
    buildings: [
      { key: 'ten_toa_nha', label: 'Tên tòa nhà' },
      { key: 'dia_chi', label: 'Địa chỉ', optional: true },
    ],
    floors: [
      {
        key: 'ma_toa_nha',
        label: 'Tòa nhà',
        options: opts('buildings', 'ten_toa_nha'),
        fixed: true,
      },
      { key: 'so_tang', label: 'Tầng thứ', type: 'number', min: -10, max: 200 },
    ],
    rooms: [
      {
        key: 'ma_tang',
        label: 'Tầng',
        options: (lists.floors || []).map((f: Row) => ({
          value: f._id,
          label:
            (lists.buildings.find((b: Row) => b._id === f.ma_toa_nha)
              ?.ten_toa_nha || '') +
            ' / Tầng ' +
            f.so_tang,
        })),
        fixed: true,
      },
      { key: 'ten_phong', label: 'Tên phòng' },
      {
        key: 'loai_phong',
        label: 'Loại phòng',
        options: values(['CLASSROOM', 'OFFICE', 'LAB', 'MEETING', 'OTHER']),
      },
    ],
    devices: [
      {
        key: 'ma_phong',
        label: 'Phòng',
        options: opts('rooms', 'ten_phong'),
        fixed: true,
      },
      { key: 'ten_thiet_bi', label: 'Tên thiết bị' },
      { key: 'dia_chi_mac', label: 'Địa chỉ MAC (không bắt buộc)', optional: true, hint: 'Demo Wokwi có thể để trống. ESP được nhận diện bằng mã thiết bị và MQTT topic.' },
      {
        key: 'chu_de_mqtt',
        label: 'MQTT topic gốc',
        hint: 'Để trống để hệ thống tạo topic riêng, tránh trùng ESP khác.',
        optional: true,
        fixed: true,
      },
      {
        key: 'cong_suat_dinh_muc',
        label: 'Công suất định mức (W)',
        type: 'number',
        min: 1,
        max: 10000000,
      },
      {
        key: 'chu_ky_gui',
        label: 'Chu kỳ gửi (giây)',
        type: 'number',
        min: 1,
        max: 60,
      },
      {
        key: 'cho_phep_dieu_khien',
        label: 'Hỗ trợ điều khiển relay',
        type: 'checkbox',
      },
    ],
    users: [
      { key: 'tai_khoan', label: 'Tài khoản' },
      { key: 'ho_ten', label: 'Họ tên' },
      {
        key: 'mat_khau',
        label: record ? 'Mật khẩu mới (để trống để giữ nguyên)' : 'Mật khẩu',
        type: 'password',
        optional: !!record,
      },
      {
        key: 'vai_tro',
        label: 'Vai trò',
        options: values(['Admin', 'QuanLy', 'NguoiXem']),
      },
      {
        key: 'buildingIds',
        label: 'Tòa nhà được truy cập',
        type: 'multiple',
        options: opts('buildings', 'ten_toa_nha'),
        optional: true,
        hint: 'Giữ Ctrl để chọn nhiều; Admin có quyền trên mọi tòa nhà',
      },
      { key: 'active', label: 'Tài khoản hoạt động', type: 'checkbox' },
    ],
    rules: [
      { key: 'ten_quy_tac', label: 'Tên quy tắc' },
      deviceField,
      {
        key: 'chi_so_can_do',
        label: 'Thông số',
        options: [
          'cong_suat_w',
          'dien_ap_v',
          'dong_dien_a',
          'nhiet_do_c',
          'dong_ro_ma',
        ].map((v) => ({ value: v, label: metricLabels[v] })),
      },
      {
        key: 'toan_tu',
        label: 'Điều kiện',
        options: values(['>', '<', '>=', '<=', '=']),
      },
      { key: 'gia_tri_nguong', label: 'Ngưỡng', type: 'number', step: 'any' },
      {
        key: 'gia_tri_phuc_hoi', label: 'Ngưỡng phục hồi (tùy chọn)', type: 'number', step: 'any', optional: true,
        hint: 'Cảnh báo cao: phục hồi dưới ngưỡng này. Cảnh báo thấp: phục hồi trên ngưỡng này. Để trống để dùng ngưỡng phát hiện.',
      },
      {
        key: 'khung_gio_ap_dung',
        label: 'Khung giờ áp dụng (tùy chọn)',
        optional: true,
        type: 'time-window',
        hint: 'Để trống cả hai ô để áp dụng cả ngày',
      },
      {
        key: 'thoi_gian_duy_tri',
        label: 'Thời gian duy trì (giây)',
        type: 'number',
        min: 0,
        max: 86400,
      },
      {
        key: 'thoi_gian_phuc_hoi',
        label: 'Thời gian ổn định để xác nhận phục hồi (giây)',
        type: 'number',
        min: 1,
        max: 86400,
        hint: 'Chỉ kết thúc khi có số đo liên tục trong khoảng cho phép; mặc định 30 giây',
      },
      {
        key: 'cooldown',
        label: 'Khoảng nhắc sự cố chưa phục hồi (giây)',
        type: 'number',
        min: 300,
        max: 604800,
      },
      {
        key: 'muc_do',
        label: 'Mức độ',
        options: ['LOW', 'MEDIUM', 'HIGH'].map((v) => ({
          value: v,
          label: severityLabels[v],
        })),
      },
      { key: 'bat', label: 'Bật quy tắc', type: 'checkbox' },
    ],
    schedules: [
      deviceField,
      { key: 'hanh_dong', label: 'Hành động', options: values(['Bật', 'Tắt']) },
      {
        key: 'gio_bat_dau',
        label: 'Giờ thực hiện (giờ Việt Nam)',
        type: 'time',
        step: '1',
      },
      {
        key: 'ngay_lap_lai',
        label: 'Ngày lặp lại',
        hint: 'T2,T3,T4,T5,T6 hoặc T7,CN',
      },
      { key: 'bat', label: 'Bật lịch hẹn giờ', type: 'checkbox' },
    ],
  };
  const [form, setForm] = useState<Row>(() => ({
    ...{
      cong_suat_dinh_muc: 2000,
      chu_ky_gui: kind === 'devices' ? 2 : 5,
      cho_phep_dieu_khien: true,
      active: true,
      buildingIds: [],
      bat: true,
      thoi_gian_duy_tri: 10,
      thoi_gian_phuc_hoi: 30,
      cooldown: 300,
      gia_tri_nguong: 1000,
      muc_do: 'HIGH',
      hanh_dong: 'Tắt',
      ngay_lap_lai: 'T2,T3,T4,T5,T6',
      chi_so_can_do: 'cong_suat_w',
      toan_tu: '>',
      loai_phong: 'CLASSROOM',
      vai_tro: 'NguoiXem',
    },
    khung_gio_bat_dau: String(record?.khung_gio_ap_dung || '').split('-')[0] || '',
    khung_gio_ket_thuc: String(record?.khung_gio_ap_dung || '').split('-')[1] || '',
    ...record,
    ...(kind === 'rules' ? { cooldown: Math.max(record?.cooldown || 300, 300) } : {}),
  }));
  const [validationError, setValidationError] = useState('');
  async function submit(e: any) {
    e.preventDefault();
    setValidationError('');
    const payload: Row = {};
    for (const f of definitions[kind]) {
      if (record && f.fixed) continue;
      if (f.type === 'time-window') {
        const start = form.khung_gio_bat_dau || '';
        const end = form.khung_gio_ket_thuc || '';
        if (start !== '' && end !== '') {
          payload.khung_gio_ap_dung = `${start}-${end}`;
        } else if (start !== '' || end !== '') {
          setValidationError('Vui lòng chọn đủ giờ bắt đầu và giờ kết thúc.');
          return;
        } else if (record) {
          payload.khung_gio_ap_dung = null;
        }
        continue;
      }
      let v = form[f.key];
      if (typeof v === 'string' && f.type !== 'password') v = v.trim();
      if (!f.optional && !['checkbox', 'multiple', 'time-window'].includes(f.type || '') && (v === '' || v === undefined)) {
        setValidationError('Vui lòng nhập ' + f.label.toLowerCase() + '.');
        return;
      }
      if (f.optional && (v === '' || v === undefined || v === null)) {
        if (record && f.key === 'dia_chi') payload[f.key] = '';
        if (record && ['khung_gio_ap_dung', 'gia_tri_phuc_hoi'].includes(f.key)) payload[f.key] = null;
        continue;
      }
      payload[f.key] =
        f.type === 'number' ? Number(v) : f.type === 'checkbox' ? !!v : v;
    }
    try {
      await save(payload);
    } catch {}
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={kindLabels[kind]}
      >
        <div className="panel-head">
          <h2>
            {record ? 'Chỉnh sửa' : 'Thêm'} {kindLabels[kind].toLowerCase()}
          </h2>
          <button aria-label="Đóng" disabled={busy} onClick={close}>
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            {definitions[kind].map((f) => (
              <label
                key={f.key}
                className={f.type === 'checkbox' ? 'checkbox-label' : ''}
              >
                {f.type === 'checkbox' ? (
                  <>
                    <input
                      type="checkbox"
                      checked={!!form[f.key]}
                      onChange={(e) =>
                        setForm({ ...form, [f.key]: e.target.checked })
                      }
                    />
                    {f.label}
                  </>
                ) : f.type === 'time-window' ? (
                  <div className="time-window">
                    <input
                      type="time"
                      aria-label="Giờ bắt đầu"
                      value={form.khung_gio_bat_dau || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          khung_gio_bat_dau: e.target.value,
                        })
                      }
                    />
                    <span>đến</span>
                    <input
                      type="time"
                      aria-label="Giờ kết thúc"
                      value={form.khung_gio_ket_thuc || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          khung_gio_ket_thuc: e.target.value,
                        })
                      }
                    />
                  </div>
                ) : (
                  <>
                    {f.label}
                    {f.options ? (
                      <select
                        required={!f.optional}
                        multiple={f.type === 'multiple'}
                        disabled={!!record && f.fixed}
                        value={form[f.key] ?? (f.type === 'multiple' ? [] : '')}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            [f.key]:
                              f.type === 'multiple'
                                ? Array.from(e.target.selectedOptions).map(
                                    (o) => o.value,
                                  )
                                : e.target.value,
                          })
                        }
                      >
                        {f.type !== 'multiple' && (
                          <option value="">Chọn…</option>
                        )}
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={!f.optional}
                        disabled={!!record && f.fixed}
                        type={f.type || 'text'}
                        value={form[f.key] ?? ''}
                        onChange={(e) =>
                          setForm({ ...form, [f.key]: e.target.value })
                        }
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        autoComplete={
                          f.type === 'password' ? 'new-password' : 'off'
                        }
                      />
                    )}
                  </>
                )}
                {f.hint && <small className="muted">{f.hint}</small>}
              </label>
            ))}
          </div>
          {(validationError || error) && (
            <div className="error">{validationError || error}</div>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>
              Hủy
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
