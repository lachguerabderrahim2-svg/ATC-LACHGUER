
import React from 'react';

interface ValueDisplayProps {
  label: string;
  value: number;
  unit: string;
  color: string;
  icon: string;
}

export const ValueDisplay: React.FC<ValueDisplayProps> = ({ label, value, unit, color, icon }) => {
  return (
    <div className="glass-card p-5 rounded-2xl flex flex-col items-center justify-center transition-all hover:scale-105">
      <div className={`text-2xl mb-2 ${color}`}>
        <i className={`fas ${icon}`}></i>
      </div>
      <span className="text-xs font-medium text-slate-400 uppercase mb-1">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tight">{value.toFixed(2)}</span>
        <span className="text-sm text-slate-500">{unit}</span>
      </div>
    </div>
  );
};
