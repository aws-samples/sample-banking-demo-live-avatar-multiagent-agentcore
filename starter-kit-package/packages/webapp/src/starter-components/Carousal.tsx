import { Spinner } from "@cloudscape-design/components";
import { useS3ListItems } from "../hooks/useStorage"
import Slider from "react-slick";
import { QUERY_KEYS } from "../utils/types";

const settings = {
    arrows: false,
    dots: true,
    className: "center",
    centerMode: false,
    infinite: true,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    pauseOnHover: true,
    speed: 1000,
    autoplaySpeed: 4000,
    cssEase: "linear",
    adaptiveHeight: true,
    focusOnSelect: false,
};
export const Carousal = () => {
    const { data: images, isLoading } = useS3ListItems(QUERY_KEYS.CAROUSAL);
    return (
        <div className="slider-container" >
            {isLoading && <Spinner />}
            <Slider {...settings}>

                {images?.map((slide) => (
                    <div key={slide.itemName} style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        height: "100%",
                        width: "100%",
                        objectFit: "cover",
                        objectPosition: "center",
                    }} >
                        <img src={slide.url} alt={slide.itemName} />
                    </div>
                ))}
            </Slider>
        </div>
    )
}