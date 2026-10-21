#ifndef SPAGHETTI_STATUS_LED_POLICY_H
#define SPAGHETTI_STATUS_LED_POLICY_H
#include <stdint.h>
/* Gentle 2-second breathing pulse, 0–25%; no floating point or PWM allocation. */
static inline uint8_t spaghetti_status_led_idle_percent(uint32_t elapsed_ms)
{
 uint32_t phase=elapsed_ms%2000U;
 return (uint8_t)((phase<=1000U?phase:2000U-phase)*25U/1000U);
}
#endif
