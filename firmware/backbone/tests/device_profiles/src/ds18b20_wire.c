#include <errno.h>
#include <string.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>
#include <zephyr/ztest.h>
static unsigned elapsed, configs, transitions, reads, locks, falling;
static unsigned samples[8], widths[8];
static uint8_t input;
static int failure;
static bool resetting, stuck, absent, level;
static gpio_flags_t flags;
static int config(const struct device *d, gpio_pin_t p, gpio_flags_t f)
{ ARG_UNUSED(d);ARG_UNUSED(p);configs++;elapsed+=25;flags=f;return 0; }
static int set(const struct device *d, gpio_pin_t p, int v)
{ ARG_UNUSED(d);ARG_UNUSED(p);if(!v)falling=elapsed;else if(transitions/2<8)widths[transitions/2]=elapsed-falling;level=v;transitions++;return 0; }
static int get(const struct device *d, gpio_pin_t p)
{ ARG_UNUSED(d);ARG_UNUSED(p);if(failure)return failure;if(resetting){reads++;return stuck?0:reads==2?absent:1;}samples[reads]=elapsed-falling;return (input>>reads++)&1; }
static void wait_us(uint32_t us){elapsed+=us;}
static unsigned lock(void){locks++;return 0;}
static void unlock(unsigned k){ARG_UNUSED(k);locks--;}
#define gpio_pin_configure config
#define gpio_pin_set_raw set
#define gpio_pin_get_raw get
#define k_busy_wait wait_us
#undef irq_lock
#undef irq_unlock
#define irq_lock lock
#define irq_unlock unlock
#include "../../../subsys/port/ds18b20_wire.h"
#undef gpio_pin_configure
#undef gpio_pin_set_raw
#undef gpio_pin_get_raw
#undef k_busy_wait
#undef irq_lock
#undef irq_unlock
static const struct gpio_dt_spec pin;
static void before(void *unused)
{ARG_UNUSED(unused);elapsed=configs=transitions=reads=locks=falling=0;memset(samples,0,sizeof(samples));memset(widths,0,sizeof(widths));input=0xa5;failure=0;resetting=stuck=absent=level=false;flags=0;}
ZTEST(ds18b20_wire,test_read_window_and_no_pad_reconfiguration)
{zassert_equal(ds_read_byte(&pin),0xa5);zassert_equal(configs,0);zassert_equal(elapsed,560);for(unsigned i=0;i<8;i++){zassert_equal(widths[i],2);zassert_equal(samples[i],12);}zassert_equal(locks,0);zassert_true(level);}
ZTEST(ds18b20_wire,test_write_widths_lsb_first)
{zassert_ok(ds_write(&pin,0xa5,false));zassert_equal(configs,0);for(unsigned i=0;i<8;i++)zassert_equal(widths[i],(0xa5>>i)&1?6:60);zassert_equal(elapsed,560);zassert_equal(locks,0);}
ZTEST(ds18b20_wire,test_parasite_strong_pullup_after_last_bit)
{zassert_ok(ds_write(&pin,0x44,true));zassert_equal(configs,1);zassert_equal(transitions,16);zassert_equal(flags,GPIO_OUTPUT_HIGH);zassert_equal(locks,0);}
ZTEST(ds18b20_wire,test_presence_and_idle)
{resetting=true;zassert_ok(ds_reset(&pin));zassert_equal(configs,1);zassert_true(flags&GPIO_OPEN_DRAIN);zassert_true(flags&GPIO_INPUT);zassert_equal(widths[0],480);zassert_equal(reads,3);zassert_equal(locks,0);}
ZTEST(ds18b20_wire,test_missing_sensor_and_stuck_line)
{resetting=true;absent=true;zassert_equal(ds_reset(&pin),-ENODEV);zassert_equal(locks,0);reads=transitions=0;stuck=true;zassert_equal(ds_reset(&pin),-EBUSY);zassert_equal(transitions,0);}
ZTEST(ds18b20_wire,test_read_error_unlocks)
{failure=-EIO;zassert_equal(ds_read_byte(&pin),-EIO);zassert_equal(locks,0);}
ZTEST_SUITE(ds18b20_wire,NULL,NULL,before,NULL,NULL);
