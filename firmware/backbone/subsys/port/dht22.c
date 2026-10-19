#include <spaghetti/port.h>
#include <errno.h>

int spaghetti_dht22_decode_frame(const uint8_t bytes[5], int16_t *temperature, uint16_t *humidity)
{
 if (!bytes || !temperature || !humidity) return -EINVAL;
 if ((uint8_t)(bytes[0] + bytes[1] + bytes[2] + bytes[3]) != bytes[4]) return -EBADMSG;
 uint16_t rh = ((uint16_t)bytes[0] << 8) | bytes[1];
 int16_t t = ((uint16_t)(bytes[2] & 0x7fU) << 8) | bytes[3];
 if (bytes[2] & 0x80U) t = -t;
 if (rh > 1000 || t < -400 || t > 800) return -ERANGE;
 *temperature = t; *humidity = rh;
 return 0;
}

int spaghetti_dht11_decode_frame(const uint8_t b[5], int16_t *temperature, uint16_t *humidity)
{
 if (!b || !temperature || !humidity) return -EINVAL;
 if ((uint8_t)(b[0]+b[1]+b[2]+b[3]) != b[4]) return -EBADMSG;
 int16_t t = b[2] * 10 + (b[3] & 0x7f);
 if (b[3] & 0x80) t = -t;
 uint16_t h = b[0] * 10 + b[1];
 if (b[1] > 9 || (b[3] & 0x7f) > 9 || h > 1000 || t < -200 || t > 800) return -ERANGE;
 *temperature = t; *humidity = h; return 0;
}
static uint8_t ds_crc(const uint8_t *bytes, size_t length)
{
 uint8_t crc = 0;
 for (size_t i=0; i<length; i++) {
   uint8_t v=bytes[i];
   for(unsigned bit=0;bit<8;bit++) { uint8_t mix=(crc^v)&1; crc>>=1; if(mix)crc^=0x8c; v>>=1; }
 }
 return crc;
}
int spaghetti_ds18b20_decode_frame(const uint8_t b[9], int16_t *temperature)
{
 if (!b || !temperature) return -EINVAL;
 if (ds_crc(b,8) != b[8]) return -EBADMSG;
 /* Compatible parts can report vendor-specific reserved bytes (5..7).
  * They are covered by CRC, but must not be interpreted as model identity.
  * Keep the configuration-bit check to reject floating/all-zero frames. */
 if ((b[4]&0x9f) != 0x1f) return -EBADMSG;
 int16_t t = (int16_t)((uint16_t)b[0] | ((uint16_t)b[1]<<8));
 unsigned resolution = (b[4]>>5)&3;
 t &= (int16_t)~((1U << (3-resolution))-1U);
 if(t < -55*16 || t > 125*16) return -ERANGE;
 *temperature=t; return 0;
}
