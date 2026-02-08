
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AccelerationData, SessionStats, GeminiAnalysis, PKDirection, TrackType, SessionRecord, AudioSettings } from './types';
import { MotionChart } from './components/MotionChart';
import { ValueDisplay } from './components/ValueDisplay';
import { analyzeMotionSession, generateSpeech, findNearbyFacilities } from './services/geminiService';

const App: React.FC = () => {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [data, setData] = useState<AccelerationData[]>([]);
  const [currentAccel, setCurrentAccel] = useState<AccelerationData>({ timestamp: 0, x: 0, y: 0, z: 0, magnitude: 0 });
  
  // Permissions & Capteurs Status
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [motionStatus, setMotionStatus] = useState<'pending' | 'granted' | 'denied'>('pending');

  // Vitesse et GPS
  const [speedKmh, setSpeedKmh] = useState<number>(0); 
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);

  // Configuration
  const [startPK, setStartPK] = useState<string>('0.000');
  const [direction, setDirection] = useState<PKDirection>('croissant');
  const [track, setTrack] = useState<TrackType>('LGV1');
  const [la, setLa] = useState<number>(1.2);
  const [li, setLi] = useState<number>(2.2);
  const [lai, setLai] = useState<number>(2.8);
  
  const [operator, setOperator] = useState<string>('TECH_ATC');
  const [line, setLine] = useState<string>('LGV');
  const [train, setTrain] = useState<string>('RGV');
  const [engineNumber, setEngineNumber] = useState<string>('');
  const [position, setPosition] = useState<string>('EN QUEUE');
  const [note, setNote] = useState<string>('');

  // Recalage PK
  const [syncPKValue, setSyncPKValue] = useState<string>('');

  // Audio & WakeLock
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    enabled: true,
    alertLA: true,
    alertLI: true,
    alertLAI: true,
    sessionEvents: true
  });
  const [isWakeLocked, setIsWakeLocked] = useState(false);

  // Historique et Sélection
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);

  const [stats, setStats] = useState<SessionStats>({ 
    startPK: 0, direction: 'croissant', track: '', thresholdLA: 1.2, thresholdLI: 2.2, thresholdLAI: 2.8,
    operator: '', line: '', train: '', engineNumber: '', position: '', note: '',
    maxVertical: 0, maxTransversal: 0, avgMagnitude: 0, duration: 0, countLA: 0, countLI: 0, countLAI: 0, startTime: 0
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSearchingMaps, setIsSearchingMaps] = useState(false);
  const [mapsResults, setMapsResults] = useState<{text: string, links: any[]} | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataRef = useRef<AccelerationData[]>([]);
  const lastTimestampRef = useRef<number>(0);
  const currentPKRef = useRef<number>(0);
  const currentSpeedRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastBeepTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- WAKE LOCK ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLocked(true);
      } catch (err: any) {
        console.error("WakeLock failed", err);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsWakeLocked(false);
    }
  };

  // --- AUDIO ---
  const playTone = (freq: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.1) => {
    if (!audioSettings.enabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  };

  // --- PERMISSIONS HANDLER ---
  const requestAllPermissions = async () => {
    setError(null);
    
    // GPS
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsStatus('granted');
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setupGpsWatch();
        },
        (err) => {
          setGpsStatus('denied');
          console.error("GPS Denied", err);
        },
        { enableHighAccuracy: true }
      );
    } else {
      setGpsStatus('denied');
    }

    // Motion Sensors (Accéléromètre)
    if (typeof DeviceMotionEvent !== 'undefined' && (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const res = await (DeviceMotionEvent as any).requestPermission();
        setMotionStatus(res === 'granted' ? 'granted' : 'denied');
      } catch (err) {
        setMotionStatus('denied');
        console.error("Motion Permission Error", err);
      }
    } else {
      // Android / Desktop non-iOS : généralement accordé par défaut si HTTPS
      setMotionStatus('granted');
    }
  };

  const setupGpsWatch = () => {
    navigator.geolocation.watchPosition(
      (pos) => {
        const speed = (pos.coords.speed || 0) * 3.6;
        setSpeedKmh(speed);
        currentSpeedRef.current = pos.coords.speed || 0;
        setGpsAccuracy(pos.coords.accuracy);
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      null,
      { enableHighAccuracy: true, maximumAge: 500 }
    );
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    const savedHistory = localStorage.getItem('atc_history_v2');
    if (savedHistory) {
      const parsed = JSON.parse(savedHistory);
      setHistory(parsed.sort((a: any, b: any) => b.id.localeCompare(a.id)));
    }

    // Tenter de détecter l'état GPS si déjà autorisé
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' as any }).then(status => {
        if (status.state === 'granted') {
          setGpsStatus('granted');
          setupGpsWatch();
        }
      });
    }
  }, []);

  // --- MOTION HANDLER ---
  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const accel = event.acceleration;
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

    const now = Date.now();
    const dt = lastTimestampRef.current === 0 ? 0 : (now - lastTimestampRef.current) / 1000;
    lastTimestampRef.current = now;

    // Calcul PK
    const deltaDist = currentSpeedRef.current * dt;
    if (deltaDist > 0) {
      currentPKRef.current += (direction === 'croissant' ? deltaDist : -deltaDist) / 1000;
    }

    const x = accel.x;
    const y = accel.y; // Transversal (ATC / Dressage)
    const z = accel.z; // Vertical (AVC / Nivellement)
    const magnitude = Math.sqrt(x*x + y*y + z*z);

    const newData: AccelerationData = { 
      timestamp: now, x, y, z, magnitude, pk: currentPKRef.current 
    };
    
    dataRef.current.push(newData);
    setCurrentAccel(newData);

    // Seuils Audio (ATC uniquement)
    const absY = Math.abs(y);
    if (now - lastBeepTimeRef.current > 400) {
      if (absY >= lai) { playTone(1500, 0.4, 'square', 0.1); lastBeepTimeRef.current = now; }
      else if (absY >= li) { playTone(1000, 0.3, 'sine', 0.1); lastBeepTimeRef.current = now; }
      else if (absY >= la) { playTone(600, 0.2, 'sine', 0.05); lastBeepTimeRef.current = now; }
    }

    // Update Stats
    if (dataRef.current.length % 5 === 0) {
      setData([...dataRef.current]);
      setStats(prev => {
        let nLA = prev.countLA;
        let nLI = prev.countLI;
        let nLAI = prev.countLAI;
        if (absY >= lai) nLAI++; else if (absY >= li) nLI++; else if (absY >= la) nLA++;
        
        return {
          ...prev,
          maxVertical: Math.max(prev.maxVertical, Math.abs(z)),
          maxTransversal: Math.max(prev.maxTransversal, absY),
          avgMagnitude: (prev.avgMagnitude * (dataRef.current.length - 1) + magnitude) / dataRef.current.length,
          duration: (now - prev.startTime) / 1000,
          countLA: nLA, countLI: nLI, countLAI: nLAI
        };
      });
    }
  }, [direction, la, li, lai]);

  const toggleMeasurement = async () => {
    if (!isMeasuring) {
      // Re-vérification des permissions
      if (motionStatus !== 'granted' || gpsStatus !== 'granted') {
        await requestAllPermissions();
        if (motionStatus !== 'granted') {
          setError("Les capteurs de mouvement ne sont pas autorisés.");
          return;
        }
      }

      setError(null);
      await requestWakeLock();
      
      const p = parseFloat(startPK) || 0;
      currentPKRef.current = p;
      lastTimestampRef.current = 0;
      dataRef.current = [];
      setData([]);
      setSyncPKValue('');
      
      setStats({
        startPK: p, direction, track, thresholdLA: la, thresholdLI: li, thresholdLAI: lai,
        operator, line, train, engineNumber, position, note,
        maxVertical: 0, maxTransversal: 0, avgMagnitude: 0, duration: 0, countLA: 0, countLI: 0, countLAI: 0,
        startTime: Date.now()
      });
      
      window.addEventListener('devicemotion', handleMotion);
      setIsMeasuring(true);
      if (audioSettings.sessionEvents) playTone(440, 0.2);
    } else {
      window.removeEventListener('devicemotion', handleMotion);
      setIsMeasuring(false);
      await releaseWakeLock();
      if (audioSettings.sessionEvents) playTone(220, 0.3);

      const record: SessionRecord = {
        id: `sess_${Date.now()}`,
        date: new Date().toLocaleString('fr-FR'),
        stats: { ...stats },
        data: [...dataRef.current],
        analysis: null
      };
      const newHistory = [record, ...history].sort((a: any, b: any) => b.id.localeCompare(a.id)).slice(0, 30);
      setHistory(newHistory);
      localStorage.setItem('atc_history_v2', JSON.stringify(newHistory));
      setSelectedSession(record);
    }
  };

  const handleSyncPK = () => {
    const newVal = parseFloat(syncPKValue);
    if (!isNaN(newVal)) {
      currentPKRef.current = newVal;
      setSyncPKValue('');
      if (audioSettings.sessionEvents) playTone(880, 0.1);
    }
  };

  const handleIAAnalysis = async () => {
    const s = selectedSession;
    if (!s || s.data.length < 10) return;
    setIsAnalyzing(true);
    setMapsResults(null);
    try {
      const result = await analyzeMotionSession(s.data, s.stats);
      const updated = history.map(h => h.id === s.id ? { ...h, analysis: result } : h);
      setHistory(updated);
      setSelectedSession({ ...s, analysis: result });
      localStorage.setItem('atc_history_v2', JSON.stringify(updated));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSpeak = async () => {
    if (!selectedSession?.analysis) return;
    setIsSpeaking(true);
    try {
      const textToSpeak = `Diagnostic expert : ${selectedSession.analysis.complianceLevel}. ${selectedSession.analysis.observations.join('. ')}. Recommandations : ${selectedSession.analysis.recommendations}`;
      const base64Audio = await generateSpeech(textToSpeak);
      if (base64Audio) {
        const audioData = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }
        
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => setIsSpeaking(false);
        audio.play();
      }
    } catch (e: any) {
      console.error(e);
      setIsSpeaking(false);
    }
  };

  const handleSearchNearby = async () => {
    if (!userLocation) {
      setError("Localisation indisponible pour la recherche Maps.");
      return;
    }
    setIsSearchingMaps(true);
    try {
      const results = await findNearbyFacilities(userLocation.lat, userLocation.lng);
      setMapsResults(results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSearchingMaps(false);
    }
  };

  const exportToCSV = (session: SessionRecord) => {
    const headers = ['Timestamp', 'PK', 'X_Longitudinal', 'Y_Transversal_ATC', 'Z_Vertical_AVC', 'Magnitude'];
    const rows = session.data.map(d => [
      d.timestamp,
      d.pk?.toFixed(5) || '',
      d.x.toFixed(4),
      d.y.toFixed(4),
      d.z.toFixed(4),
      d.magnitude.toFixed(4)
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ATC_Session_${session.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportAllHistoryToCSV = () => {
    if (history.length === 0) return;
    const headers = ['ID', 'Date', 'Operator', 'Line', 'Track', 'Train', 'Engine', 'StartPK', 'Direction', 'MaxVertical_AVC', 'MaxTransversal_ATC', 'LA_Alerts', 'LI_Alerts', 'LAI_Alerts', 'Compliance'];
    const rows = history.map(h => [
      h.id, h.date, h.stats.operator, h.stats.line, h.stats.track, h.stats.train, h.stats.engineNumber,
      h.stats.startPK.toFixed(3), h.stats.direction, h.stats.maxVertical.toFixed(3), h.stats.maxTransversal.toFixed(3),
      h.stats.countLA, h.stats.countLI, h.stats.countLAI, h.analysis?.complianceLevel || 'Non Analysé'
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ATC_Global_Export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (audioSettings.sessionEvents) playTone(1200, 0.1);
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      if (lines.length < 2) return;
      const importedData: AccelerationData[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 6) continue;
        importedData.push({
          timestamp: parseInt(parts[0]),
          pk: parseFloat(parts[1]),
          x: parseFloat(parts[2]),
          y: parseFloat(parts[3]),
          z: parseFloat(parts[4]),
          magnitude: parseFloat(parts[5])
        });
      }
      if (importedData.length > 0) {
        const first = importedData[0];
        const last = importedData[importedData.length-1];
        const newRecord: SessionRecord = {
          id: `import_${Date.now()}`,
          date: `Imported ${new Date().toLocaleDateString()}`,
          stats: {
            ...stats,
            startPK: first.pk || 0,
            maxVertical: Math.max(...importedData.map(d => Math.abs(d.z))),
            maxTransversal: Math.max(...importedData.map(d => Math.abs(d.y))),
            duration: (last.timestamp - first.timestamp) / 1000,
            startTime: first.timestamp
          },
          data: importedData,
          analysis: null
        };
        const newHistory = [newRecord, ...history].sort((a: any, b: any) => b.id.localeCompare(a.id));
        setHistory(newHistory);
        localStorage.setItem('atc_history_v2', JSON.stringify(newHistory));
        setSelectedSession(newRecord);
        setError(null);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans antialiased overflow-x-hidden pb-24">
      {/* HUD - Header Status Bar */}
      <nav className="sticky top-0 z-50 bg-[#0f172a]/80 backdrop-blur-xl border-b border-slate-800/60 px-6 py-4 flex justify-between items-center shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-600">
              ATC MONITOR PRO
            </h1>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Inspection Unit</span>
          </div>
          {isMeasuring && (
            <div className="flex items-center gap-2 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/30">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black text-red-500 uppercase">REC</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {gpsAccuracy !== null && (
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[9px] text-slate-500 font-bold uppercase">GPS Accuracy</span>
              <span className={`text-[10px] font-mono ${gpsAccuracy < 10 ? 'text-emerald-400' : 'text-orange-400'}`}>
                ±{gpsAccuracy.toFixed(1)}m
              </span>
            </div>
          )}
          <button 
            onClick={toggleMeasurement}
            className={`px-6 py-3 rounded-2xl font-black text-xs transition-all flex items-center gap-2 transform active:scale-95 ${
              isMeasuring 
                ? 'bg-red-600 shadow-lg shadow-red-900/40' 
                : 'bg-indigo-600 shadow-lg shadow-indigo-900/40 hover:bg-indigo-500'
            }`}
          >
            <i className={`fas ${isMeasuring ? 'fa-stop-circle' : 'fa-play'}`}></i>
            {isMeasuring ? 'STOP SESSION' : 'START INSPECTION'}
          </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 pt-8 space-y-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/40 p-4 rounded-2xl flex items-center gap-3 text-red-400 text-xs font-bold animate-in fade-in zoom-in duration-300">
            <i className="fas fa-triangle-exclamation text-lg"></i>
            {error}
          </div>
        )}

        {/* Readiness Section */}
        {!isMeasuring && !selectedSession && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-top-4 duration-500">
            <div className={`glass-card p-6 rounded-3xl border ${motionStatus === 'granted' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Capteurs de Mouvement</span>
                <i className={`fas ${motionStatus === 'granted' ? 'fa-check-circle text-emerald-500' : 'fa-times-circle text-red-500'}`}></i>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase">{motionStatus === 'granted' ? 'Accéléromètres Activés' : 'Accès Restreint'}</p>
            </div>
            <div className={`glass-card p-6 rounded-3xl border ${gpsStatus === 'granted' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Positionnement GPS</span>
                <i className={`fas ${gpsStatus === 'granted' ? 'fa-satellite text-emerald-500' : 'fa-location-dot text-red-500'}`}></i>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase">{gpsStatus === 'granted' ? 'Géolocalisation Active' : 'GPS Non Autorisé'}</p>
            </div>
            <button 
              onClick={requestAllPermissions}
              className="glass-card p-6 rounded-3xl border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-center gap-4 hover:bg-indigo-500/20 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <i className="fas fa-lock-open text-white"></i>
              </div>
              <div className="text-left">
                <p className="text-xs font-black text-white uppercase tracking-widest">Autoriser les Capteurs</p>
                <p className="text-[9px] text-indigo-400 font-bold uppercase">Initialiser les accès</p>
              </div>
            </button>
          </div>
        )}

        {(isMeasuring || selectedSession) ? (
          <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-700">
            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <ValueDisplay label="Vitesse" value={speedKmh} unit="km/h" color="text-indigo-400" icon="fa-bolt" />
              <ValueDisplay 
                label="Point Kilo" 
                value={selectedSession ? (selectedSession.data[selectedSession.data.length-1]?.pk || 0) : currentAccel.pk || 0} 
                unit="pk" color="text-blue-400" icon="fa-map-pin" 
              />
              <ValueDisplay label="γz Max (AVC)" value={selectedSession ? selectedSession.stats.maxVertical : stats.maxVertical} unit="m/s²" color="text-emerald-400" icon="fa-arrows-up-down" />
              <ValueDisplay label="Alertes ATC" value={selectedSession ? (selectedSession.stats.countLI + selectedSession.stats.countLAI) : (stats.countLI + stats.countLAI)} unit="pts" color="text-red-400" icon="fa-bolt-lightning" />
            </div>

            {/* Recalage PK en direct */}
            {isMeasuring && (
              <div className="glass-card p-6 rounded-3xl border-indigo-500/20 flex flex-col md:flex-row items-center gap-6 shadow-xl">
                <div className="flex-1 space-y-1">
                  <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Recalage PK Terrain</h3>
                  <p className="text-[10px] text-slate-500 font-medium">Saisissez le PK exact lu sur le terrain pour corriger le décalage.</p>
                </div>
                <div className="flex w-full md:w-auto gap-3">
                  <input 
                    type="number" step="0.001" 
                    value={syncPKValue} 
                    onChange={(e) => setSyncPKValue(e.target.value)}
                    placeholder="PK Terrain (ex: 12.450)"
                    className="flex-1 md:w-48 bg-slate-900 border border-slate-700 h-12 rounded-xl px-4 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500/50 outline-none"
                  />
                  <button 
                    onClick={handleSyncPK}
                    className="bg-indigo-600 hover:bg-indigo-500 px-6 h-12 rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
                  >
                    Recaler
                  </button>
                </div>
              </div>
            )}

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <MotionChart 
                data={selectedSession ? selectedSession.data : data} 
                dataKey="z" name="AVC (Nivellement)" 
                stroke="#6366f1" 
              />
              <MotionChart 
                data={selectedSession ? selectedSession.data : data} 
                dataKey="y" name="ATC (Dressage)" 
                stroke="#f43f5e" 
                thresholds={{ la, li, lai }}
              />
            </div>

            {/* AI Result Section */}
            {selectedSession && !isMeasuring && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={handleIAAnalysis} 
                    disabled={isAnalyzing}
                    className="flex-[2] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 h-16 rounded-2xl font-black text-sm flex items-center justify-center gap-3 shadow-xl shadow-indigo-900/20 transition-all"
                  >
                    {isAnalyzing ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-brain"></i>}
                    {isAnalyzing ? 'ANALYSE IA EN COURS...' : 'GÉNÉRER DIAGNOSTIC IA'}
                  </button>
                  <button 
                    onClick={() => exportToCSV(selectedSession!)}
                    className="flex-1 bg-slate-800 border border-slate-700 hover:bg-slate-700 h-16 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all"
                  >
                    <i className="fas fa-file-csv text-emerald-400"></i> Export CSV
                  </button>
                </div>

                {selectedSession.analysis && (
                  <div className="glass-card border-indigo-500/30 bg-indigo-500/5 p-8 rounded-3xl animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex flex-col md:flex-row justify-between gap-6 mb-8">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg relative">
                          <i className="fas fa-robot text-white"></i>
                          {isSpeaking && <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>}
                        </div>
                        <div>
                          <h3 className="font-black text-xl text-white tracking-tight">Expertise Infrastructure</h3>
                          <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">{selectedSession.analysis.activityType}</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                         <button 
                            onClick={handleSpeak}
                            disabled={isSpeaking}
                            className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center hover:bg-indigo-600 transition-colors disabled:opacity-50"
                            title="Lire le diagnostic"
                          >
                            <i className={`fas ${isSpeaking ? 'fa-spinner fa-spin' : 'fa-volume-up'}`}></i>
                         </button>
                        <div className={`self-start px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg ${
                          selectedSession.analysis.complianceLevel === 'Conforme' ? 'bg-emerald-500 text-white' :
                          selectedSession.analysis.complianceLevel === 'Surveillance' ? 'bg-orange-500 text-white' : 'bg-red-500 text-white'
                        }`}>
                          Statut: {selectedSession.analysis.complianceLevel}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <i className="fas fa-eye text-indigo-500"></i> Observations Techniques
                        </h4>
                        <ul className="space-y-3">
                          {selectedSession.analysis.observations.map((obs, idx) => (
                            <li key={idx} className="bg-slate-900/50 p-4 rounded-xl border border-slate-800/50 text-sm text-slate-300 leading-relaxed">
                              {obs}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-6">
                         <div>
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                              <i className="fas fa-map-location-dot text-indigo-500"></i> Points Critiques (PK)
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {selectedSession.analysis.anomalousPKs.map((pk, idx) => (
                                <span key={idx} className="bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs font-mono font-bold">
                                  PK {pk}
                                </span>
                              ))}
                            </div>
                         </div>
                         <div>
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                              <i className="fas fa-wrench text-indigo-500"></i> Recommandations
                            </h4>
                            <p className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-2xl text-sm italic text-indigo-200 leading-relaxed">
                              "{selectedSession.analysis.recommendations}"
                            </p>
                         </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-800/50">
                       <button 
                        onClick={handleSearchNearby}
                        disabled={isSearchingMaps}
                        className="w-full h-12 bg-emerald-600/10 border border-emerald-500/30 rounded-xl text-emerald-400 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 hover:text-white transition-all"
                       >
                         {isSearchingMaps ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-location-arrow"></i>}
                         Rechercher Points de Maintenance Proches (Google Maps)
                       </button>

                       {mapsResults && (
                         <div className="mt-6 bg-slate-900/80 rounded-2xl p-6 border border-emerald-500/20 animate-in fade-in duration-300">
                           <h5 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-4">Établissements Ferroviaires à Proximité</h5>
                           <div className="prose prose-invert prose-xs text-slate-300 mb-6">
                             {mapsResults.text}
                           </div>
                           <div className="space-y-2">
                             {mapsResults.links.map((chunk: any, i: number) => chunk.maps && (
                               <a key={i} href={chunk.maps.uri} target="_blank" rel="noopener noreferrer" className="block p-3 bg-slate-800 rounded-lg text-[10px] font-bold text-indigo-400 border border-slate-700 hover:border-indigo-500 transition-colors">
                                 <i className="fas fa-external-link-alt mr-2"></i> {chunk.maps.title || "Voir sur Google Maps"}
                               </a>
                             ))}
                           </div>
                         </div>
                       )}
                    </div>
                  </div>
                )}
                
                <button 
                  onClick={() => setSelectedSession(null)}
                  className="w-full h-14 bg-slate-800 border border-slate-700/50 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition-all active:scale-95"
                >
                  <i className="fas fa-chevron-left mr-2"></i> Retour Historique
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-500">
            {/* Session Configuration Card */}
            <section className="lg:col-span-2 space-y-8">
              <div className="glass-card p-8 rounded-[2rem] border-slate-800/50">
                <h2 className="text-sm font-black text-slate-500 uppercase tracking-[0.3em] mb-8 flex items-center gap-3">
                  <div className="w-1 h-4 bg-indigo-500 rounded-full"></div>
                  Mission Configuration
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Initial PK</label>
                      <input 
                        type="number" step="0.001" value={startPK} onChange={(e) => setStartPK(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-5 text-indigo-400 font-mono text-lg focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Direction</label>
                        <select value={direction} onChange={(e) => setDirection(e.target.value as PKDirection)}
                          className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-4 text-sm font-bold appearance-none cursor-pointer">
                          <option value="croissant">Croissant</option>
                          <option value="decroissant">Décroissant</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Track</label>
                        <select value={track} onChange={(e) => setTrack(e.target.value as TrackType)}
                          className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-4 text-sm font-bold">
                          <option value="LGV1">LGV 1</option>
                          <option value="LGV2">LGV 2</option>
                          <option value="V1">V1</option>
                          <option value="V2">V2</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Operator ID</label>
                        <input value={operator} onChange={(e) => setOperator(e.target.value)} className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-5 text-sm font-bold" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Train</label>
                        <input value={train} onChange={(e) => setTrain(e.target.value)} className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-5 text-sm font-bold" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Engine / Car Number</label>
                      <input value={engineNumber} onChange={(e) => setEngineNumber(e.target.value)} className="w-full bg-slate-900 border border-slate-700 h-14 rounded-2xl px-5 text-sm font-bold" />
                    </div>
                  </div>
                </div>

                <div className="mt-10 pt-8 border-t border-slate-800/50">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Seuils ATC (Dressage γ en m/s²)</h3>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-yellow-500/80 uppercase">Warning (LA)</label>
                      <input type="number" step="0.1" value={la} onChange={(e) => setLa(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 h-12 rounded-xl text-center font-mono font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-orange-500/80 uppercase">Intervention (LI)</label>
                      <input type="number" step="0.1" value={li} onChange={(e) => setLi(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 h-12 rounded-xl text-center font-mono font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-red-500/80 uppercase">Immediate (LAI)</label>
                      <input type="number" step="0.1" value={lai} onChange={(e) => setLai(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 h-12 rounded-xl text-center font-mono font-bold" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Settings */}
              <div className="glass-card p-6 rounded-3xl border-slate-800/40 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${audioSettings.enabled ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                    <i className="fas fa-volume-high"></i>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest">Feedback Audio (ATC)</span>
                </div>
                <button 
                  onClick={() => setAudioSettings(p => ({ ...p, enabled: !p.enabled }))}
                  className={`w-14 h-8 rounded-full p-1 transition-all ${audioSettings.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform ${audioSettings.enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* Import UI */}
              <div className="glass-card p-6 rounded-3xl border-slate-800/40 border-dashed flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-xl">
                  <i className="fas fa-file-import"></i>
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest mb-1">Importer une session CSV</h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Recharger des données externes pour analyse</p>
                </div>
                <input type="file" accept=".csv" ref={fileInputRef} onChange={handleImportCSV} className="hidden" />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-8 py-3 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-700 transition-all"
                >
                  Choisir un fichier .csv
                </button>
              </div>
            </section>

            {/* History Sidebar */}
            <aside className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-3">
                  <i className="fas fa-clock-rotate-left text-indigo-500"></i>
                  Recent Records
                </h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={exportAllHistoryToCSV}
                    disabled={history.length === 0}
                    title="Export All Records to CSV"
                    className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <i className="fas fa-file-export text-[10px]"></i>
                  </button>
                  <span className="text-[10px] font-mono text-slate-600 font-bold">{history.length} ITEMS</span>
                </div>
              </div>
              <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="glass-card p-8 rounded-3xl text-center border-dashed border-slate-800">
                    <i className="fas fa-folder-open text-slate-700 text-3xl mb-4"></i>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">No previous runs</p>
                  </div>
                ) : (
                  history.map(record => (
                    <div 
                      key={record.id}
                      onClick={() => setSelectedSession(record)}
                      className="glass-card p-5 rounded-2xl border-slate-800/40 hover:border-indigo-500/50 hover:bg-indigo-500/[0.02] transition-all cursor-pointer group relative overflow-hidden"
                    >
                      {record.analysis && (
                        <div className="absolute top-0 right-0 p-1.5">
                           <div className="bg-emerald-500/20 text-emerald-400 w-6 h-6 rounded-lg flex items-center justify-center animate-pulse">
                              <i className="fas fa-brain text-[10px]"></i>
                           </div>
                        </div>
                      )}
                      <div className="flex justify-between items-start mb-3">
                         <span className="text-[10px] font-mono text-indigo-400 font-bold tracking-tighter">
                           {record.date}
                         </span>
                      </div>
                      <div className="font-bold text-sm mb-1 group-hover:text-indigo-300 transition-colors">
                        VOIE {record.stats.track || '?' } — {record.stats.line}
                      </div>
                      <div className="flex items-center gap-2 text-[8px] font-black text-slate-400 uppercase mb-3">
                        <i className="fas fa-user-gear text-indigo-500"></i>
                        ID OP: {record.stats.operator || 'UNKNOWN'}
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                           <span className="flex items-center gap-1"><i className="fas fa-map-pin text-blue-500"></i> PK {record.stats.startPK.toFixed(3)}</span>
                           <span className="flex items-center gap-1"><i className="fas fa-arrows-up-down text-emerald-500"></i> γz: {record.stats.maxVertical.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className={`h-1 flex-1 rounded-full bg-slate-800`}>
                            <div 
                              className={`h-full rounded-full ${record.stats.countLAI > 0 ? 'bg-red-500' : record.stats.countLI > 0 ? 'bg-orange-500' : 'bg-indigo-500'}`}
                              style={{ width: `${Math.min(100, (record.stats.countLA + record.stats.countLI + record.stats.countLAI) * 5)}%` }}
                            ></div>
                          </div>
                          <span className="text-[8px] font-mono text-slate-600">{record.data.length} pts</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 h-20 bg-slate-950/80 backdrop-blur-xl border-t border-slate-800/60 flex items-center justify-around px-8 z-40">
        <button className="flex flex-col items-center gap-1.5 text-indigo-500 transition-transform active:scale-90" onClick={() => setSelectedSession(null)}>
          <i className="fas fa-compass text-lg"></i>
          <span className="text-[8px] font-black uppercase tracking-widest">Dashboard</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-500 hover:text-indigo-400 transition-all">
          <i className="fas fa-gear text-lg"></i>
          <span className="text-[8px] font-black uppercase tracking-widest">Settings</span>
        </button>
        <div className="flex flex-col items-center gap-1.5 opacity-30">
          <span className="text-[10px] font-black text-white tracking-tighter">ATC LACHGUER</span>
          <span className="text-[7px] font-mono">2.6.0-PRO</span>
        </div>
      </footer>

      <style>{`
        .glass-card {
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.3);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
};

export default App;
