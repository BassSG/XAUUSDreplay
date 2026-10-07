import {Component,type ReactNode} from 'react';
export default class ChartBoundary extends Component<{children:ReactNode;resetKey:string},{error:string;retry:number}>{
 state={error:'',retry:0};
 static getDerivedStateFromError(error:Error){return {error:error.message||'แสดงกราฟไม่สำเร็จ'};}
 componentDidUpdate(previous:{resetKey:string}){if(previous.resetKey!==this.props.resetKey&&this.state.error)this.setState({error:''});}
 render(){return this.state.error?<div className="chart-recovery" role="alert"><strong>กราฟแสดงผลไม่สำเร็จ</strong><p>{this.state.error}</p><button onClick={()=>this.setState(s=>({error:'',retry:s.retry+1}))}>เปิดกราฟอีกครั้ง</button><small>รอบฝึกและออเดอร์ยังอยู่ · ตรวจ Pine Script ใน Indicators ได้</small></div>:<div key={this.state.retry}>{this.props.children}</div>;}
}
