
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { AccelerationData } from '../types';

interface MotionChartProps {
  data: AccelerationData[];
  dataKey: 'x' | 'y' | 'z';
  name: string;
  stroke: string;
  thresholds?: {
    la: number;
    li: number;
    lai: number;
  };
}

export const MotionChart: React.FC<MotionChartProps> = ({ data, dataKey, name, stroke, thresholds }) => {
  // On limite l'affichage aux 500 derniers points pour la performance
  const displayData = data.slice(-500); 

  return (
    <div className="h-[350px] w-full glass-card p-5 rounded-3xl border border-slate-800/60 shadow-inner">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.2)]" style={{ backgroundColor: stroke }}></div>
          {name}
        </h3>
        {thresholds && (
          <div className="flex gap-3 text-[9px] font-bold">
            <span className="text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">LA: {thresholds.la}</span>
            <span className="text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">LI: {thresholds.li}</span>
            <span className="text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">LAI: {thresholds.lai}</span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <LineChart data={displayData} margin={{ top: 5, right: 15, left: -15, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={true} opacity={0.2} />
          <XAxis 
            dataKey="pk" 
            type="number"
            domain={['auto', 'auto']}
            hide={false}
            tick={{fontSize: 9, fill: '#64748b', fontWeight: 'bold'}}
            tickFormatter={(val) => val.toFixed(3)}
            label={{ value: 'PK (km)', position: 'insideBottom', offset: -10, fill: '#475569', fontSize: 10, fontWeight: 'bold' }}
            stroke="#334155"
            minTickGap={30}
          />
          <YAxis 
            stroke="#334155" 
            domain={['auto', 'auto']} 
            tick={{fontSize: 9, fill: '#64748b', fontWeight: 'bold'}} 
            tickCount={7}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#0f172a', 
              border: '1px solid #334155', 
              borderRadius: '12px', 
              fontSize: '11px',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
            }}
            itemStyle={{ padding: '0px', color: stroke }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}
            labelFormatter={(val) => `PK: ${Number(val).toFixed(5)}`}
          />
          
          <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
          
          {thresholds && (
            <>
              <ReferenceLine y={thresholds.la} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={thresholds.li} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={thresholds.lai} stroke="#ef4444" strokeWidth={1} strokeOpacity={0.8} />
              <ReferenceLine y={-thresholds.la} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={-thresholds.li} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={-thresholds.lai} stroke="#ef4444" strokeWidth={1} strokeOpacity={0.8} />
            </>
          )}

          <Line 
            type="monotone" 
            dataKey={dataKey} 
            stroke={stroke} 
            strokeWidth={1.5} 
            dot={false} 
            isAnimationActive={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
