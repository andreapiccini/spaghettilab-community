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
