/** Let paint and input run without nested setTimeout's minimum-delay clamp. */
export function yieldTask(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Consume unchanged geometry/traffic recipes either for synchronous callers or in short live-scene slices. */
export function finishSteps<T>(steps:Generator<void,T>){
  for(;;){const step=steps.next();if(step.done)return step.value;}
}

export async function prepareSteps<T>(steps:Generator<void,T>,pause:()=>Promise<void> = yieldTask){
  try{
    for(;;){
      const deadline=performance.now()+3;
      do{const step=steps.next();if(step.done)return step.value;}while(performance.now()<deadline);
      await pause();
    }
  }finally{steps.return(undefined as T);}
}
