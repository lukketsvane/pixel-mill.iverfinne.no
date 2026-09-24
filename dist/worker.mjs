import {processPixels} from './pixel-core.mjs';
self.onmessage=({data:{job,...input}})=>{try{const result=processPixels(input);self.postMessage({job,result},[result.data.buffer,result.labels.buffer])}catch(error){self.postMessage({job,error:error.message})}};
