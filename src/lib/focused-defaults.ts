import allIndy from '../indicators/all-indy-ebw-focus.pine?raw';
import ebwFibo from '../indicators/ebw-fibo-focus.pine?raw';
import type {IndicatorSpec} from './engine';
import {focusIds,installFocusedIndicators} from './focused-indicators';

export const focusedDefaults: readonly IndicatorSpec[] = [
  {id:'0ce78de2-7bf2-4e73-a4b0-de3c5ad1e811',builtinId:focusIds[0],name:'All Indy · EBW Focus',source:allIndy,enabled:true},
  {id:'929e9d3a-918f-4fcc-8c16-747b8e8e4ca1',builtinId:focusIds[1],name:'EBW Fibo · Focus',source:ebwFibo,enabled:true},
];

const knownVariants=new Set([
  '67b56c80e76effbf9c93cc71db600e894fb29ce8603f5029179a87274b416dcf',
  'e06130a168e21986faa2b0add63340619d7edb507f5cb2271907f46db21f45a2',
  'f3342bcb5b9efd5ee389c45fabd33ee39bab8b0121d65c6afabf93f41f74a3d7',
  'd55883ceea3b10b9c3104315a100e4c8fd3409e1780f76c8a46bcca8375a8521',
]);

export function prepareFocusedIndicators(saved: IndicatorSpec[]) {
  const existing=focusedDefaults.every(base=>saved.some(study=>study.id===base.id));
  return installFocusedIndicators(saved,focusedDefaults,existing?new Set<string>():knownVariants);
}
