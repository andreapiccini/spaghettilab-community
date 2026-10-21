import { it,expect } from "vitest";
import { SpaghettiClient } from "../spaghetti-client.js";
import { FakeTransport } from "../fakes/fake-transport.js";
import { decodeRequest, encodeResponse, Operation, ProtocolStatus } from "../../envelope.js";
import { decodeOne } from "../../cbor.js";
import { encodeMap, bytesField, requireMap, requireBytes, requireU32 } from "../../fields.js";
import { encodeGetConfigResponse } from "../../operations/config.js";
it("relays separate clients to their addressed CAN board and preserves inner correlation",async()=>{
 class Gateway extends FakeTransport {
  override async send(bytes:Uint8Array){
   await super.send(bytes);
   const outer=decodeRequest(bytes);expect(outer.operation).toBe(Operation.CAN_REQUEST);
   const map=requireMap(decodeOne(outer.payload),"relay");const node=requireU32(map,0,"relay");
   const inner=decodeRequest(requireBytes(map,1,"relay"));expect(inner.operation).toBe(Operation.GET_CONFIG);
   this.deliverResponse(encodeResponse({correlationId:outer.correlationId,status:ProtocolStatus.OK,payload:encodeMap([bytesField(0,
    encodeResponse({correlationId:inner.correlationId,status:ProtocolStatus.OK,payload:encodeGetConfigResponse({generation:node,sha256:new Uint8Array(32),configBytes:new Uint8Array([0xa0])})}))])}));
  }
 }
 const transport=new Gateway(),gateway=new SpaghettiClient(transport);
 const a=gateway.forCanNode(0xe17fd0),b=gateway.forCanNode(0xe1c4fc);
 const results=await Promise.all([a.getConfig(),b.getConfig()]);
 expect(results.map(r=>r.generation)).toEqual([0xe17fd0,0xe1c4fc]);expect(transport.sent).toHaveLength(2);
 a.dispose();b.dispose();gateway.dispose();
});
it("rejects invalid CAN identities before sending a request",()=>{
 const transport=new FakeTransport(),client=new SpaghettiClient(transport);
 for(const node of [0,-1,1.5,0x1000000])expect(()=>client.forCanNode(node)).toThrow();
 expect(transport.sent).toHaveLength(0);client.dispose();
});
