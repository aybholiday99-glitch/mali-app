export async function settle() { for (let n=0;n<80;n++) await Promise.resolve(); }
export function fakeSyncScheduler(start=Date.parse('2026-10-13T00:00:00Z')) {
  let now=start,seq=0;const timers=new Map();
  const scheduler={now:()=>now,random:()=>0,setTimeout:(callback,ms)=>{const id=++seq;timers.set(id,{callback,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  return {scheduler,now:()=>now,size:()=>timers.size,advance:async ms=>{
    now+=ms;
    await settle();
    for(let n=0;n<100;n++){
      const item=[...timers].filter(([,job])=>job.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!item)break;timers.delete(item[0]);item[1].callback();await settle();
      if(n===99)throw new Error('Scheduler spun without delay.');
    }
    await settle();
  }};
}
